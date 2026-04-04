# App iOS (Capacitor) — IEStudio

La app nativa es un **complemento**: envuelve la misma web desplegada en Vercel (`https://iestudio.vercel.app`) dentro de un **WKWebView**. No sustituye al proyecto Next.js; el dashboard, las APIs, NextAuth y la sincronización con Neon siguen siendo los mismos.

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

## Google OAuth en WebView (importante)

Google **puede bloquear o limitar** el inicio de sesión en navegadores incrustados (WKWebView). Si al pulsar «Iniciar sesión con Google» ves error o pantalla en blanco:

1. Prueba iniciar sesión en **Safari** en el mismo iPhone y luego usa la app (si compartiera cookies — en la práctica a veces no).
2. Usa **Añadir a la pantalla de inicio** desde Safari (PWA): el flujo OAuth usa Safari completo y suele funcionar.
3. **Siguiente paso técnico** (si lo necesitas): integrar `@capacitor/browser` para abrir el login en el sistema y volver con un esquema de URL personalizado; eso implica cambios acotados en cliente/servidor. No está implementado por defecto para no tocar el flujo web.

## Paridad con la web

- Misma URL de producción → mismas funciones (calendario, Study Planner, sync en la nube, etc.).
- Los datos en **localStorage** son los del WebView de la app; la sincronización vuelca a Neon igual que en el navegador.

## App Store / TestFlight

Para distribución fuera de tu dispositivo necesitas cuenta de desarrollador, iconos en todos los tamaños, capturas, política de privacidad, etc. El proyecto Capacitor es el punto de partida; el bundle id actual es `com.agustmun.iestudio` (definido en `capacitor.config.ts`).
