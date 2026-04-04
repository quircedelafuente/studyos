# IEStudio — puente Blackboard (Chrome / Edge, Manifest V3)

Permite que la web de **IEStudio** llame a la **API REST de Blackboard Learn** usando la **sesión que ya tienes en una pestaña de Blackboard**, sin pegar cookies en la app.

## Cómo funciona

1. La página de IEStudio envía un mensaje a la extensión (`externally_connectable`).
2. El **service worker** busca una pestaña cuya URL sea del mismo origen que la URL base configurada (p. ej. `https://blackboard.ie.edu/*`).
3. Si no hay pestaña → error claro: abre Blackboard e inicia sesión.
4. El worker envía al **content script** de esa pestaña un mensaje `BB_FETCH` con el `path` de la API (p. ej. `/learn/api/public/v1/users/me/courses`).
5. El content script ejecuta `fetch(url, { credentials: 'include' })` **en el origen de Blackboard** → van las cookies de sesión y las reglas CORS son las del LMS.
6. Se intenta adjuntar cabeceras anti-CSRF habituales (meta tags, cookies tipo `BbRouter`, nombres con *xsrf*).

Las cookies **no** se envían a servidores de IEStudio ni se guardan en texto plano para pegar.

## Instalación

1. Abre `chrome://extensions` (o `edge://extensions`).
2. Activa **Modo de desarrollador**.
3. **Cargar descomprimida** → selecciona esta carpeta `extensions/blackboard-bridge`.
4. Copia el **ID** de la extensión y ponlo en el `.env.local` de IEStudio:

   ```bash
   NEXT_PUBLIC_BB_BRIDGE_EXTENSION_ID=abcdefghijklmnop...
   ```

5. Reinicia `npm run dev`.

## Producción

En `manifest.json`, dentro de `externally_connectable.matches`, añade el origen exacto donde esté desplegada IEStudio (por ejemplo `https://tu-dominio.vercel.app/*`). Vuelve a cargar la extensión tras editar.

## Permisos de host

Por defecto: `https://blackboard.ie.edu/*` y `https://*.blackboard.com/*`. Para otra institución, edita `host_permissions` y `content_scripts.matches` en `manifest.json`.

## Endpoints usados por IEStudio

- `GET /learn/api/public/v1/users/me/courses` (paginado)
- `GET /learn/api/public/v1/courses/{courseId}`
- `GET /learn/api/public/v1/terms/{termId}` (si existe en tu versión)
- `GET /learn/api/public/v1/courses/{courseId}/gradebook/columns` (paginado)
- `GET /learn/api/public/v1/courses/{courseId}/gradebook/columns/{columnId}`
