# Despliegue en Railway (o cualquier host con variable PORT).
FROM python:3.11-slim

WORKDIR /app

RUN pip install --no-cache-dir \
  "fastapi>=0.115.0" \
  "uvicorn[standard]>=0.34.0" \
  "notebooklm-py>=0.3.4" \
  "python-multipart>=0.0.18"

COPY main.py gemini_chat_models.py notebooklm_custom_chat.py ./

ENV PORT=8000
EXPOSE 8000

CMD sh -c 'exec uvicorn main:app --host 0.0.0.0 --port "${PORT}"'
