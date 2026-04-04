/**
 * GET /api/auth/mobile-callback
 *
 * Auth.js redirige aquí tras un login OAuth exitoso cuando el callbackUrl es
 * este endpoint (flujo iOS móvil).
 *
 * Devuelve una página HTML que navega al esquema personalizado `iestudio://`
 * para que iOS vuelva a la app. Las cookies de sesión ya están en el cookie
 * store compartido de Safari/SFSafariViewController; al recargar el WKWebView
 * (iOS 14+, WKWebsiteDataStore.default() comparte con Safari) la sesión queda activa.
 */
export const dynamic = "force-dynamic";

export function GET() {
  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>IEStudio – Sesión iniciada</title>
  <style>
    body {
      margin: 0;
      font-family: system-ui, -apple-system, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100dvh;
      background: #f9fafb;
      color: #111827;
    }
    .card {
      text-align: center;
      padding: 2rem;
      max-width: 320px;
    }
    .icon { font-size: 3rem; margin-bottom: 1rem; }
    h1 { font-size: 1.25rem; font-weight: 600; margin: 0 0 0.5rem; }
    p { color: #6b7280; font-size: 0.875rem; margin: 0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✅</div>
    <h1>Sesión iniciada</h1>
    <p>Volviendo a IEStudio…</p>
  </div>
  <script>
    // Abre el esquema personalizado para que iOS regrese a la app
    window.location.replace('iestudio://auth-callback');
  </script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
