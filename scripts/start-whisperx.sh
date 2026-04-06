#!/usr/bin/env bash
# Arranca el compañero WhisperX de IEStudio.
# Uso: bash scripts/start-whisperx.sh
# Variables de entorno opcionales:
#   WHISPERX_MODEL=base|small|medium|large-v2   (default: base)
#   WHISPERX_PORT=16789                          (default: 16789)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPANION_DIR="$SCRIPT_DIR/../companion/whisperx"

if [[ ! -d "$COMPANION_DIR/.venv" ]]; then
  echo "Venv no encontrado. Ejecuta primero:"
  echo "  bash companion/whisperx/bootstrap.sh"
  exit 1
fi

WHISPERX_MODEL="${WHISPERX_MODEL:-base}"
PORT="${WHISPERX_PORT:-16789}"

echo "Arrancando WhisperX companion — modelo: $WHISPERX_MODEL — puerto: $PORT"
echo "Pararlo: Ctrl+C"
echo ""

cd "$COMPANION_DIR"
source .venv/bin/activate
exec env WHISPERX_MODEL="$WHISPERX_MODEL" uvicorn app:app --host 127.0.0.1 --port "$PORT"
