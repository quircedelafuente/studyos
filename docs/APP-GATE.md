# App Gate (Vercel) — acceso solo “yo” + “mi app”

Este proyecto usa un **middleware** para bloquear el sitio en producción:

- **Navegador (cualquier)**: accede con un **código** (`/gate`) y recibe una cookie httpOnly `__Host-iestudio-app-gate=1`.
- **App móvil**: hace un `POST /api/app-gate/exchange` con headers HMAC y recibe la misma cookie httpOnly.

## Variables de entorno (Vercel → Production)

- `APP_GATE_PASSWORD`: código de acceso para humanos (largo y aleatorio)
- `APP_GATE_SECRET`: secreto HMAC (larga y aleatoria)

## Flujo para la app móvil

1. Antes de cargar la web, la app llama:
   - `POST https://<tu-dominio>/api/app-gate/exchange`
   - Headers:
     - `x-app-id`: `ios` (o `android`)
     - `x-app-ts`: unix seconds (10 dígitos)
     - `x-app-sig`: base64url(HMAC_SHA256(secret, appId + "." + ts + "." + pathWithQuery))
2. Si es válido, el servidor setea la cookie `__Host-iestudio-app-gate`.
3. A partir de ahí, el WebView puede navegar normalmente: el middleware permite por cookie.

## Mensajes de bloqueo

Si no hay cookie de App Gate, el middleware devuelve `403`.

## Acceso desde navegador

1. Abre `/gate`
2. Introduce `APP_GATE_PASSWORD`
3. El servidor deja cookie por 90 días (por navegador).

