#!/usr/bin/env bash
# Despliegue estable: copia sin .git para que Vercel no valide autor del último commit
# (evita "Git author must have access…") + reintentos ante fallos de red/API.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP"
}
trap cleanup EXIT

if [[ ! -d "$ROOT/.vercel" ]]; then
  echo "Falta $ROOT/.vercel (ejecuta: npx vercel link)" >&2
  exit 1
fi

rsync -a \
  --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude '.next' \
  --exclude 'out' \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude '**/.venv' \
  --exclude 'downloads' \
  "$ROOT/" "$TMP/"

cd "$TMP"

for attempt in 1 2 3; do
  if npx vercel deploy --prod --yes "$@"; then
    exit 0
  fi
  if [[ "$attempt" -lt 3 ]]; then
    echo "Deploy falló (intento $attempt/3). Reintentando en 10s…" >&2
    sleep 10
  fi
done

echo "Deploy falló tras 3 intentos." >&2
exit 1
