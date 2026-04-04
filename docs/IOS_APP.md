# App iOS (Capacitor) — IEStudio

La app nativa es un **complemento**: envuelve la misma web desplegada en Vercel (`https://studyos-delta.vercel.app`) dentro de un **WKWebView**. No sustituye al proyecto Next.js; el dashboard, las APIs, NextAuth y la sincronización con Neon siguen siendo los mismos.

## Requisitos

- **macOS** con **Xcode** (última versión estable recomendada).
- **Node.js** ≥ 20.9 y **npm**.
- **iPhone** con cable (o red para desarrollo inalámbrico) para instalar en dispositivo.
- Cuenta **Apple ID** (gratis) para firmar en tu propio teléfono; cuenta **Apple Developer Program** (de pago) solo si necesitas **TestFlight** o **App Store**.

## Configuración del proyecto

| Archivo | Descripción |
|--------|-------------|
| [capacitor.config.ts](../capacitor.config.ts) | `appId`, `appName`, `webDir`, `server.url` (URL de producción). |
| [public/capacitor-shell/index.html](../public/capacitor-shell/index.html) | Mínimo estático; Capacitor exige `webDir`. La app carga la URL remota. |
| `ios/` | Proyecto Xcode generado por Capacitor. |

Cambiar la URL de la app: edita `server.url` en `capacitor.config.ts` y ejecuta `npm run cap:sync`.

## Comandos útiles

```bash
npm install
npm run cap:sync      # Copia webDir y regenera capacitor.config.json en ios/
npm run cap:open:ios  # Abre el workspace en Xcode
```

Si añades plugins de Capacitor más adelante, vuelve a ejecutar `npm run cap:sync`.

## Abrir en Xcode y compilar

1. `npm run cap:open:ios` (o abre `ios/App/App.xcworkspace` en Xcode).
2. En el navegador de proyecto, selecciona el target **App**.
3. **Signing & Capabilities**: elige tu **Team** (Apple ID personal o equipo de desarrollador).
4. Conecta el iPhone, elígelo como destino de ejecución.
5. **Run** (▶). La primera vez puede hace falta confiar en el desarrollador en el iPhone: Ajustes → General → VPN y gestión de dispositivos.

**Nota:** Con Apple ID gratuito, el certificado de desarrollo caduca aproximadamente a los **7 días**; hay que volver a firmar/instalar.

## CocoaPods

La carpeta `ios/App/Pods` no se versiona. Tras clonar el repo:

```bash
cd ios/App && pod install && cd ../..
```

`npm run cap:sync` ejecuta `pod install` cuando actualizas iOS desde Capacitor.

## Pantalla negra al abrir la app

- Con **modo oscuro** en el iPhone, el WKWebView usaba el fondo del sistema (negro) hasta que cargaba la web; el proyecto fija **fondo blanco** en `capacitor.config.ts` (`backgroundColor`).
- Si sigue en negro: comprueba red, URL en `server.url`, y que hayas ejecutado `npm run cap:sync` tras cambiar la config.

## Xcode instala pero “no arranca” / depurador

- Cierra otras ventanas de Xcode, **Product → Clean Build Folder**, desenchufa y vuelve a enchufar el iPhone.
- **Edit Scheme → Run → Info**: desactiva **Wait for the executable to be launched** si estuviera activo.
- Prueba **Run** con **Debug executable** desactivado (mismo menú del scheme): a veces el depurador (LLDB) no engancha y la app no pasa al primer plano.
- Si la instalación funciona, abre el icono **manualmente** en la pantalla de inicio; el problema suele ser el **attach del debugger**, no la instalación.

## Google OAuth en WebView (importante)

Google **puede bloquear o limitar** el inicio de sesión en navegadores incrustados (WKWebView). En `capacitor.config.ts` se usa un **User-Agent tipo Safari** en iOS para mejorar compatibilidad; aun así puede fallar.

1. Prueba **Añadir a la pantalla de inicio** desde **Safari** (PWA): el flujo OAuth usa el navegador completo y suele funcionar igual que en escritorio.
2. Si en la app sigue fallando, usa la web en Safari; la sesión **no** se comparte automáticamente con el WebView de la app (almacenamiento distinto).
3. **Siguiente paso técnico** (si lo necesitas): integrar `@capacitor/browser` + deep link / token en backend; no está implementado por defecto para no tocar el flujo web.

## Paridad con la web

- Misma URL de producción → mismas funciones (calendario, Study Planner, sync en la nube, etc.).
- Los datos en **localStorage** son los del WebView de la app; la sincronización vuelca a Neon igual que en el navegador.

## App Store / TestFlight

Para distribución fuera de tu dispositivo necesitas cuenta de desarrollador, iconos en todos los tamaños, capturas, política de privacidad, etc. El proyecto Capacitor es el punto de partida; el bundle id actual es `com.agustmun.iestudio` (definido en `capacitor.config.ts`).
