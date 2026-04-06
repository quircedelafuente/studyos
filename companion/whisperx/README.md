# Compañero WhisperX (IEStudio Class Notes)

Servicio HTTP en **127.0.0.1** compatible con la webapp: `POST /transcribe` (campo `audio`).

## Requisitos del sistema

1. **Python 3.10 u 3.11** (recomendado).
2. **ffmpeg** instalado y en el `PATH` (WhisperX lo usa para leer mp3/m4a/etc.).

   - macOS (Homebrew): `brew install ffmpeg`
   - Ubuntu/Debian: `sudo apt install ffmpeg`

## Instalación (entorno virtual)

Desde la raíz del repo:

```bash
cd companion/whisperx
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install --upgrade pip
```

### GPU NVIDIA (recomendado)

Instala PyTorch con CUDA **antes** del resto (ajusta `cu124` a tu versión si hace falta):

```bash
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu124
pip install -r requirements.txt
```

### Solo CPU (o macOS sin CUDA)

```bash
pip install -r requirements.txt
```

La primera vez WhisperX / faster-whisper **descargarán pesos** (cientos de MB según el modelo).

## Arranque

```bash
cd companion/whisperx
source .venv/bin/activate
uvicorn app:app --host 127.0.0.1 --port 16789
```

O desde la raíz del monorepo:

```bash
npm run class-notes:companion-whisperx
```

(ese script asume que ya existe `companion/whisperx/.venv` y las dependencias instaladas).

Comprueba: [http://127.0.0.1:16789/health](http://127.0.0.1:16789/health)

## Variables de entorno

| Variable | Default | Descripción |
|----------|---------|-------------|
| `IESTUDIO_CORS_ORIGIN` | `http://localhost:3000` | Origen de la web; varios valores separados por coma. |
| `WHISPERX_MODEL` | `base` | Tamaño: `tiny`, `base`, `small`, `medium`, `large-v2`, `large-v3`. Más grande = mejor calidad y más RAM/VRAM. |
| `WHISPERX_DEVICE` | auto (`cuda` si hay GPU, si no `cpu`) | Forzar `cuda` o `cpu`. |
| `WHISPERX_COMPUTE_TYPE` | `float16` (CUDA) / `int8` (CPU) | Ver documentación faster-whisper para tu hardware. |
| `WHISPERX_BATCH_SIZE` | `8` | Bajar (p. ej. `4`) si falta VRAM. |
| `WHISPERX_DOWNLOAD_ROOT` | (vacío) | Carpeta cache de modelos. |
| `WHISPERX_MAX_UPLOAD_MB` | `200` | Tamaño máximo del audio subido. |

## Uso con IEStudio

1. Arranca este servidor **antes** de usar Class Notes con audio.
2. En la app, URL del compañero: `http://127.0.0.1:16789` (por defecto).
3. Pulsa **Generar apuntes con IA** (el audio se transcribe aquí y luego OpenRouter genera el markdown en el servidor de Next).

Si algo falla, revisa la consola de `uvicorn` y que `ffmpeg -version` funcione en la misma terminal.

## Notas

- **Alineación de palabras / diarización** de WhisperX no están activadas en este servidor (solo transcripción tipo Whisper) para mantener el servicio simple y estable; se puede ampliar más adelante.
- En **Apple Silicon**, si `pip install` de `whisperx` da problemas con dependencias, suele ayudar usar Python 3.11 y las ruedas oficiales de `torch` para macOS.
