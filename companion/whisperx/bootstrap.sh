#!/usr/bin/env bash
# Bootstrap del compañero WhisperX para IEStudio.
# Requiere Python 3.11 (brew install python@3.11).
# Uso: bash companion/whisperx/bootstrap.sh
set -euo pipefail
cd "$(dirname "$0")"

PYTHON="${PYTHON:-}"
if [[ -z "$PYTHON" ]]; then
  for candidate in python3.11 python3.12 python3.10 python3; do
    if command -v "$candidate" &>/dev/null && "$candidate" -c "import sys; assert sys.version_info >= (3,10)" 2>/dev/null; then
      PYTHON="$candidate"
      break
    fi
  done
fi

if [[ -z "$PYTHON" ]]; then
  echo "ERROR: no se encontró Python 3.10+. Instálalo con: brew install python@3.11"
  exit 1
fi

echo "Usando $($PYTHON --version)"

if [[ ! -d .venv ]]; then
  "$PYTHON" -m venv .venv
fi

# shellcheck source=/dev/null
source .venv/bin/activate
pip install --upgrade pip --quiet

if [[ "${SKIP_TORCH_INDEX:-}" != "1" ]] && command -v nvidia-smi &>/dev/null; then
  echo "NVIDIA detectada: instalando torch+cu124..."
  pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu124 --quiet || true
fi

pip install -r requirements.txt --quiet

echo ""
echo "Listo. Para arrancar el compañero:"
echo "  cd companion/whisperx && source .venv/bin/activate"
echo "  WHISPERX_MODEL=base uvicorn app:app --host 127.0.0.1 --port 16789"
