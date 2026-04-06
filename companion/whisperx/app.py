"""
Servidor local WhisperX para IEStudio Class Notes.
Contrato: POST /transcribe (multipart campo "audio") → {"text": "...", "language": "..."}
"""

from __future__ import annotations

import logging
import os
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("iestudio-whisperx")

_state: dict = {}


def _env_device_compute() -> tuple[str, str]:
    """device, compute_type para whisperx.load_model."""
    import torch

    forced = os.environ.get("WHISPERX_DEVICE", "").strip().lower()
    if forced == "cuda":
        if not torch.cuda.is_available():
            logger.warning("WHISPERX_DEVICE=cuda pero CUDA no está disponible; uso CPU.")
            return "cpu", os.environ.get("WHISPERX_COMPUTE_TYPE", "int8")
        return "cuda", os.environ.get("WHISPERX_COMPUTE_TYPE", "float16")
    if forced == "cpu":
        return "cpu", os.environ.get("WHISPERX_COMPUTE_TYPE", "int8")

    if torch.cuda.is_available():
        return "cuda", os.environ.get("WHISPERX_COMPUTE_TYPE", "float16")
    # MPS: WhisperX/faster-whisper suelen ir mejor en CPU en macOS; opcional forzar.
    return "cpu", os.environ.get("WHISPERX_COMPUTE_TYPE", "int8")


def _load_model():
    import whisperx

    model_name = os.environ.get("WHISPERX_MODEL", "base").strip()
    device, compute_type = _env_device_compute()
    batch_size = int(os.environ.get("WHISPERX_BATCH_SIZE", "8"))

    logger.info(
        "Cargando WhisperX model=%s device=%s compute_type=%s (primera vez puede descargar pesos)",
        model_name,
        device,
        compute_type,
    )
    model = whisperx.load_model(
        model_name,
        device,
        compute_type=compute_type,
        download_root=os.environ.get("WHISPERX_DOWNLOAD_ROOT") or None,
    )
    _state["whisperx"] = whisperx
    _state["model"] = model
    _state["device"] = device
    _state["batch_size"] = max(1, batch_size)
    logger.info("Modelo listo.")


@asynccontextmanager
async def lifespan(_: FastAPI):
    try:
        _load_model()
    except Exception:
        logger.exception("No se pudo cargar WhisperX al arrancar")
        raise
    yield


_middleware_params = dict(
    allow_credentials=True,
    allow_methods=["POST", "OPTIONS", "GET"],
    allow_headers=["*"],
)
_origins_env = os.environ.get("IESTUDIO_CORS_ORIGIN", "http://localhost:3000").strip()
_cors_origins = [o.strip() for o in _origins_env.split(",") if o.strip()]

app = FastAPI(title="IEStudio WhisperX Companion", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins or ["http://localhost:3000"],
    **_middleware_params,
)

MAX_UPLOAD_BYTES = int(os.environ.get("WHISPERX_MAX_UPLOAD_MB", "200")) * 1024 * 1024


@app.get("/health")
def health():
    return {
        "ok": bool(_state.get("model")),
        "device": _state.get("device"),
        "model": os.environ.get("WHISPERX_MODEL", "base"),
    }


@app.post("/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    if not _state.get("model"):
        raise HTTPException(status_code=503, detail="Modelo no cargado")

    whisperx = _state["whisperx"]
    model = _state["model"]
    batch_size = _state["batch_size"]

    suffix = Path(audio.filename or "audio").suffix.lower()
    if suffix not in (
        ".wav",
        ".mp3",
        ".m4a",
        ".ogg",
        ".webm",
        ".flac",
        ".mp4",
        ".mpeg",
        "",
    ):
        suffix = ".wav"

    raw = await audio.read()
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Audio demasiado grande (máx. {MAX_UPLOAD_BYTES // (1024 * 1024)} MB)",
        )
    if len(raw) < 256:
        raise HTTPException(status_code=400, detail="Fichero de audio vacío o demasiado pequeño")

    tmp_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(raw)
            tmp_path = tmp.name

        audio_arr = whisperx.load_audio(tmp_path)
        result = model.transcribe(
            audio_arr,
            batch_size=batch_size,
        )
        segments = result.get("segments") or []
        parts: list[str] = []
        for seg in segments:
            t = (seg.get("text") or "").strip()
            if t:
                parts.append(t)
        text = " ".join(parts).strip()
        language = result.get("language")
        if isinstance(language, str):
            lang_out: str | None = language
        else:
            lang_out = None

        if not text:
            raise HTTPException(
                status_code=422,
                detail="WhisperX no produjo texto (¿audio sin voz o formato raro?)",
            )

        return {"text": text, "language": lang_out}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("transcribe failed")
        raise HTTPException(
            status_code=500,
            detail=str(e)[:800],
        ) from e
    finally:
        if tmp_path and os.path.isfile(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
