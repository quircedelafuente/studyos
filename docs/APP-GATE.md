# App Gate (Vercel) — acceso solo “yo” + “mi app”

Este proyecto usa un **middleware** para bloquear el sitio en producción:

- **Navegador (tú)**: solo pasa si tu sesión de Auth.js tiene el email permitido.
- **App móvil**: hace un `POST /api/app-gate/exchange` con headers HMAC y recibe una cookie httpOnly `__Host-iestudio-app-gate=1`.

## Variables de entorno (Vercel → Production)

- `APP_GATE_OWNER_EMAIL`: tu email (ej. `tu@correo.com`)
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

Si no hay cookie y no estás logueado como `APP_GATE_OWNER_EMAIL`, el middleware devuelve `403`.

