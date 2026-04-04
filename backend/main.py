from __future__ import annotations

import asyncio
import tempfile
import mimetypes
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request, UploadFile, File
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

from notebooklm import NotebookLMClient
from gemini_chat_models import list_gemini_chat_models, resolve_gemini_model_options
from notebooklm_custom_chat import notebooklm_chat_ask_with_options
from notebooklm.exceptions import (
    AuthError,
    NotebookLMError,
    NotebookNotFoundError,
    SourceNotFoundError,
    ArtifactNotFoundError,
)

# ---------------------------------------------------------------------------
# Client singleton
# ---------------------------------------------------------------------------

_client: NotebookLMClient | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _client
    try:
        _client = await NotebookLMClient.from_storage()
        await _client.__aenter__()
    except Exception:
        _client = None
    yield
    if _client:
        await _client.__aexit__(None, None, None)
        _client = None


app = FastAPI(lifespan=lifespan)


def error_payload(detail: str, code: str) -> dict[str, str]:
    return {"error": detail, "detail": detail, "code": code}


def get_client() -> NotebookLMClient:
    if _client is None:
        raise HTTPException(status_code=401, detail="No active session.")
    return _client


# ---------------------------------------------------------------------------
# Error handler
# ---------------------------------------------------------------------------


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    detail = str(exc.detail) if exc.detail else "Request failed"
    code = f"HTTP_{exc.status_code}"
    return JSONResponse(status_code=exc.status_code, content=error_payload(detail, code))


@app.exception_handler(NotebookLMError)
async def notebooklm_error_handler(request, exc: NotebookLMError):
    if isinstance(exc, AuthError):
        return JSONResponse(
            status_code=401, content=error_payload(str(exc), "NOTEBOOKLM_AUTH")
        )
    if isinstance(
        exc, (NotebookNotFoundError, SourceNotFoundError, ArtifactNotFoundError)
    ):
        return JSONResponse(
            status_code=404, content=error_payload(str(exc), "NOTEBOOKLM_NOT_FOUND")
        )
    return JSONResponse(
        status_code=502, content=error_payload(str(exc), "NOTEBOOKLM_UPSTREAM")
    )


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------


@app.get("/auth/status")
async def auth_status():
    """Siempre 200 si el API está vivo; sin sesión NotebookLM → authenticated false."""
    if _client is None:
        return {"authenticated": False, "connected": False}
    return {"authenticated": True, "connected": _client.is_connected}


# ---------------------------------------------------------------------------
# Notebooks
# ---------------------------------------------------------------------------


class CreateNotebookBody(BaseModel):
    title: str


@app.get("/notebooks")
async def list_notebooks():
    client = get_client()
    notebooks = await client.notebooks.list()
    return [
        {
            "id": nb.id,
            "title": nb.title,
            "created_at": nb.created_at.isoformat() if nb.created_at else None,
            "sources_count": nb.sources_count,
        }
        for nb in notebooks
    ]


@app.post("/notebooks")
async def create_notebook(body: CreateNotebookBody):
    clean_title = body.title.strip()
    if not clean_title:
        raise HTTPException(status_code=422, detail="Title cannot be empty.")
    if len(clean_title) > 120:
        raise HTTPException(
            status_code=422, detail="Title cannot be longer than 120 characters."
        )
    client = get_client()
    nb = await client.notebooks.create(clean_title)
    return JSONResponse(
        status_code=201,
        content={
            "id": nb.id,
            "title": nb.title,
            "created_at": nb.created_at.isoformat() if nb.created_at else None,
            "sources_count": nb.sources_count,
        },
    )


@app.get("/notebooks/{notebook_id}")
async def get_notebook(notebook_id: str):
    client = get_client()
    nb = await client.notebooks.get(notebook_id)
    return {
        "id": nb.id,
        "title": nb.title,
        "created_at": nb.created_at.isoformat() if nb.created_at else None,
        "sources_count": nb.sources_count,
    }


@app.delete("/notebooks/{notebook_id}")
async def delete_notebook(notebook_id: str):
    client = get_client()
    ok = await client.notebooks.delete(notebook_id)
    return {"deleted": ok}


# ---------------------------------------------------------------------------
# Sources
# ---------------------------------------------------------------------------


def _serialize_source(s: Any) -> dict[str, Any]:
    return {
        "id": s.id,
        "title": s.title,
        "url": s.url,
        "kind": s.kind.value if s.kind else None,
        "status": (
            "ready"
            if s.is_ready
            else "processing" if s.is_processing else "error"
        ),
        "created_at": s.created_at.isoformat() if s.created_at else None,
    }


@app.get("/notebooks/{notebook_id}/sources")
async def list_sources(notebook_id: str):
    client = get_client()
    sources = await client.sources.list(notebook_id)
    return [_serialize_source(s) for s in sources]


class AddSourceURLBody(BaseModel):
    url: str


@app.post("/notebooks/{notebook_id}/sources/url")
async def add_source_url(notebook_id: str, body: AddSourceURLBody):
    client = get_client()
    source = await client.sources.add_url(notebook_id, body.url, wait=True)
    return _serialize_source(source)


class AddSourceTextBody(BaseModel):
    title: str
    content: str


@app.post("/notebooks/{notebook_id}/sources/text")
async def add_source_text(notebook_id: str, body: AddSourceTextBody):
    client = get_client()
    source = await client.sources.add_text(
        notebook_id, body.title, body.content, wait=True
    )
    return _serialize_source(source)


@app.post("/notebooks/{notebook_id}/sources/file")
async def add_source_file(
    notebook_id: str,
    file: list[UploadFile] = File(...),
):
    client = get_client()
    uploaded_sources: list[dict[str, Any]] = []
    failed_uploads: list[dict[str, str]] = []
    for item in file:
        original_name = Path(item.filename or "upload").name
        suffix = Path(original_name).suffix
        stem = Path(original_name).stem or "upload"
        safe_prefix = "".join(ch for ch in stem if ch.isalnum() or ch in ("-", "_"))[:40]
        if not safe_prefix:
            safe_prefix = "upload"
        with tempfile.NamedTemporaryFile(
            delete=False, prefix=f"{safe_prefix}_", suffix=suffix
        ) as tmp:
            tmp.write(await item.read())
            tmp_path = tmp.name
        try:
            # Retry on intermittent SOURCE_ID registration failures from upstream.
            source = None
            last_error: Exception | None = None
            for attempt in range(6):
                try:
                    # Wait for processing result so frontend does not keep stale "processing".
                    source = await client.sources.add_file(
                        notebook_id,
                        tmp_path,
                        mime_type=item.content_type,
                        wait=True,
                        wait_timeout=300.0,
                    )
                    break
                except NotebookLMError as exc:
                    last_error = exc
                    msg = str(exc)
                    if "SOURCE_ID" in msg and attempt < 5:
                        await asyncio.sleep(0.4 * (attempt + 1))
                        continue
                    raise

            if source is None:
                raise last_error or HTTPException(
                    status_code=502, detail="Source upload failed."
                )

            serialized = _serialize_source(source)
            # Always expose original filename in immediate response.
            serialized["title"] = original_name
            uploaded_sources.append(serialized)
            # Small spacing helps reduce upstream throttling during multi-upload bursts.
            await asyncio.sleep(0.12)
        except Exception as exc:
            failed_uploads.append(
                {
                    "filename": original_name,
                    "error": str(exc),
                }
            )
        finally:
            Path(tmp_path).unlink(missing_ok=True)

    if not uploaded_sources and failed_uploads:
        raise HTTPException(
            status_code=502,
            detail=f"No se pudo subir ningun archivo. {failed_uploads[0]['error']}",
        )

    return {"uploaded": uploaded_sources, "failed": failed_uploads}


@app.delete("/notebooks/{notebook_id}/sources/{source_id}")
async def delete_source(notebook_id: str, source_id: str):
    client = get_client()
    ok = await client.sources.delete(notebook_id, source_id)
    return {"deleted": ok}


# ---------------------------------------------------------------------------
# Chat
# ---------------------------------------------------------------------------


class ChatBody(BaseModel):
    question: str
    source_ids: list[str] | None = None
    conversation_id: str | None = None
    gemini_model: str | None = Field(
        default=None,
        description="Preset Gemini para el chat (lista en GET /gemini-chat-models).",
    )


@app.get("/gemini-chat-models")
async def gemini_chat_models():
    """Lista de modelos Gemini disponibles para el chat (presets del backend)."""
    return {"models": list_gemini_chat_models()}


@app.post("/notebooks/{notebook_id}/chat")
async def chat(notebook_id: str, body: ChatBody):
    client = get_client()
    try:
        model_options = resolve_gemini_model_options(body.gemini_model)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    result = await notebooklm_chat_ask_with_options(
        client.chat,
        notebook_id,
        body.question,
        source_ids=body.source_ids,
        conversation_id=body.conversation_id,
        model_options=model_options,
    )
    return {
        "answer": result.answer,
        "conversation_id": result.conversation_id,
        "turn_number": result.turn_number,
        "references": [
            {
                "source_id": r.source_id,
                "cited_text": r.cited_text,
                "citation_number": r.citation_number,
            }
            for r in result.references
        ],
    }


@app.get("/notebooks/{notebook_id}/chat/history")
async def chat_history(notebook_id: str):
    client = get_client()
    history = await client.chat.get_history(notebook_id)
    return [{"question": q, "answer": a} for q, a in history]


# ---------------------------------------------------------------------------
# Artifacts
# ---------------------------------------------------------------------------


def _serialize_artifact(a: Any) -> dict[str, Any]:
    return {
        "id": a.id,
        "title": a.title,
        "kind": a.kind.value if a.kind else None,
        "status": a.status_str,
        "created_at": a.created_at.isoformat() if a.created_at else None,
    }


@app.get("/notebooks/{notebook_id}/artifacts")
async def list_artifacts(notebook_id: str, artifact_type: str | None = None):
    client = get_client()
    from notebooklm import ArtifactType

    at = ArtifactType(artifact_type) if artifact_type else None
    artifacts = await client.artifacts.list(notebook_id, artifact_type=at)
    return [_serialize_artifact(a) for a in artifacts]


class GenerateArtifactBody(BaseModel):
    artifact_type: str
    source_ids: list[str] | None = None
    language: str = "en"
    instructions: str | None = None
    audio_format: int | None = None
    audio_length: int | None = None
    report_format: str | None = None


@app.post("/notebooks/{notebook_id}/artifacts/generate")
async def generate_artifact(notebook_id: str, body: GenerateArtifactBody):
    client = get_client()
    from notebooklm import AudioFormat, AudioLength, ReportFormat

    kwargs: dict[str, Any] = {
        "notebook_id": notebook_id,
        "source_ids": body.source_ids,
    }

    if body.artifact_type == "audio":
        if body.audio_format:
            kwargs["audio_format"] = AudioFormat(body.audio_format)
        if body.audio_length:
            kwargs["audio_length"] = AudioLength(body.audio_length)
        if body.language:
            kwargs["language"] = body.language
        if body.instructions:
            kwargs["instructions"] = body.instructions
        status = await client.artifacts.generate_audio(**kwargs)
    elif body.artifact_type == "report":
        if body.report_format:
            kwargs["report_format"] = ReportFormat(body.report_format)
        if body.language:
            kwargs["language"] = body.language
        if body.instructions:
            kwargs["custom_prompt"] = body.instructions
        status = await client.artifacts.generate_report(**kwargs)
    elif body.artifact_type == "quiz":
        if body.instructions:
            kwargs["instructions"] = body.instructions
        status = await client.artifacts.generate_quiz(**kwargs)
    elif body.artifact_type == "flashcards":
        if body.instructions:
            kwargs["instructions"] = body.instructions
        status = await client.artifacts.generate_flashcards(**kwargs)
    elif body.artifact_type == "study_guide":
        if body.language:
            kwargs["language"] = body.language
        status = await client.artifacts.generate_study_guide(**kwargs)
    elif body.artifact_type == "mind_map":
        if body.instructions:
            kwargs["instructions"] = body.instructions
        status = await client.artifacts.generate_mind_map(**kwargs)
    else:
        raise HTTPException(
            status_code=422, detail=f"Unknown artifact type: {body.artifact_type}"
        )

    return {"task_id": status.task_id, "status": status.status}


@app.get("/notebooks/{notebook_id}/artifacts/{artifact_id}/status")
async def artifact_status(notebook_id: str, artifact_id: str):
    client = get_client()
    artifact = await client.artifacts.get(notebook_id, artifact_id)
    if not artifact:
        raise HTTPException(status_code=404, detail="Artifact not found")
    return _serialize_artifact(artifact)


@app.get("/notebooks/{notebook_id}/artifacts/{artifact_id}/download")
async def download_artifact(notebook_id: str, artifact_id: str):
    client = get_client()
    artifact = await client.artifacts.get(notebook_id, artifact_id)
    if not artifact:
        raise HTTPException(status_code=404, detail="Artifact not found")

    kind = artifact.kind.value if artifact.kind else "unknown"
    mime_by_kind = {
        "audio": "audio/mpeg",
        "video": "video/mp4",
        "report": "text/markdown; charset=utf-8",
        "mind_map": "application/json",
        "data_table": "text/csv; charset=utf-8",
        "quiz": "application/json",
        "flashcards": "application/json",
        "infographic": "image/png",
        "slide_deck": "application/pdf",
    }
    with tempfile.TemporaryDirectory() as tmpdir:
        out = Path(tmpdir) / artifact_id
        download_method = {
            "audio": client.artifacts.download_audio,
            "report": client.artifacts.download_report,
            "quiz": client.artifacts.download_quiz,
            "flashcards": client.artifacts.download_flashcards,
            "mind_map": client.artifacts.download_mind_map,
            "infographic": client.artifacts.download_infographic,
            "slide_deck": client.artifacts.download_slide_deck,
            "data_table": client.artifacts.download_data_table,
            "video": client.artifacts.download_video,
        }.get(kind)

        if not download_method:
            raise HTTPException(status_code=422, detail=f"Cannot download {kind}")

        path = await download_method(notebook_id, str(out), artifact_id=artifact_id)
        file_path = Path(path)
        if not file_path.exists():
            raise HTTPException(status_code=502, detail="Downloaded artifact file missing")

        content = file_path.read_bytes()
        guessed_type, _ = mimetypes.guess_type(file_path.name)
        media_type = mime_by_kind.get(kind) or guessed_type or "application/octet-stream"
        headers = {"content-disposition": f'inline; filename="{file_path.name}"'}
        return Response(content=content, media_type=media_type, headers=headers)


@app.delete("/notebooks/{notebook_id}/artifacts/{artifact_id}")
async def delete_artifact(notebook_id: str, artifact_id: str):
    client = get_client()
    ok = await client.artifacts.delete(notebook_id, artifact_id)
    return {"deleted": ok}


# ---------------------------------------------------------------------------
# Sharing
# ---------------------------------------------------------------------------


class ShareBody(BaseModel):
    public: bool


@app.get("/notebooks/{notebook_id}/sharing")
async def get_sharing(notebook_id: str):
    client = get_client()
    status = await client.sharing.get_status(notebook_id)
    return {
        "is_public": status.is_public,
        "access": status.access.name.lower(),
        "view_level": status.view_level.name.lower(),
        "share_url": status.share_url,
        "shared_users": [
            {
                "email": u.email,
                "permission": u.permission.name.lower(),
                "display_name": u.display_name,
            }
            for u in status.shared_users
        ],
    }


@app.post("/notebooks/{notebook_id}/sharing")
async def set_sharing(notebook_id: str, body: ShareBody):
    client = get_client()
    status = await client.sharing.set_public(notebook_id, body.public)
    return {"is_public": status.is_public, "share_url": status.share_url}
