# Compañero local (Class Notes — transcripción de audio)

La webapp envía el **audio de la clase** solo a un servicio que tú ejecutas en tu máquina (loopback). El servidor de IEStudio **no** recibe el fichero de audio.

## Flujo al pulsar «Generar apuntes con IA»

1. Si hay archivo de audio, el navegador llama primero a **`POST /transcribe`** del compañero (WhisperX o stub) y obtiene el texto.
2. Ese texto (junto con lo que hubiera en el cuadro de transcripción, fotos y PDF) se envía a **`/api/class-notes/generate`**, que usa OpenRouter para redactar el markdown final.

El botón **«Solo transcribir (vista previa)»** sigue existiendo si quieres ver la transcripción sin gastar una llamada al modelo de apuntes.

## WhisperX (recomendado)

Instalación y arranque **completos** están en **[`companion/whisperx/README.md`](../companion/whisperx/README.md)**.

Resumen:

1. Instala **ffmpeg** (`brew install ffmpeg` en macOS).
2. Una vez:

   ```bash
   npm run class-notes:whisperx:bootstrap
   ```

3. Cada sesión de trabajo:

   ```bash
   npm run class-notes:companion-whisperx
   ```

4. En Class Notes, URL del compañero: `http://127.0.0.1:16789`.

## Contrato HTTP (v1)

- **Base URL** configurable en la UI (por defecto `http://127.0.0.1:16789`).
- **`POST /transcribe`**
  - Cuerpo: `multipart/form-data` con un campo de fichero llamado **`audio`**.
  - Respuesta **200** y JSON: `{ "text": string, "language"?: string }`.
  - Errores: JSON opcional `{ "error": string }` con status 4xx/5xx.
- **`GET /health`**: estado del modelo (servidor WhisperX).

### CORS

Configura `IESTUDIO_CORS_ORIGIN` en el compañero (ver README de WhisperX). Por defecto `http://localhost:3000`.

## Stub de prueba (sin WhisperX)

Para probar la web sin instalar Python/torch:

```bash
npm run class-notes:companion-stub
```
