"use client";

function useIsLocalhost(): boolean {
  if (typeof window === "undefined") return true;
  const h = window.location.hostname;
  return h === "localhost" || h === "127.0.0.1";
}

export function NotebookLMAuthBanner() {
  const local = useIsLocalhost();
  return (
    <div className="mx-4 mt-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 md:mx-10 md:mt-8">
      <p className="text-sm font-semibold text-amber-900">
        No se detectó sesión de NotebookLM en el servidor
      </p>
      <p className="mt-1 text-xs text-amber-800">
        {local ? (
          <>
            En terminal ejecuta primero{" "}
            <code className="font-mono-cli rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium">
              npm run notebooklm:login
            </code>{" "}
            y luego{" "}
            <code className="font-mono-cli rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium">
              npm run notebooklm:backend
            </code>{" "}
            en esta máquina.
          </>
        ) : (
          <>
            La librería <code className="font-mono text-[11px]">notebooklm-py</code> admite auth
            por variable de entorno (sin volumen). Pasos:
          </>
        )}
      </p>
      {!local ? (
        <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-xs text-amber-900">
          <li>
            En tu ordenador (con backend local o solo CLI):{" "}
            <code className="rounded bg-amber-100 px-1 font-mono text-[11px]">
              npm run notebooklm:login
            </code>{" "}
            y completa el login con Google.
          </li>
          <li>
            Abre el archivo{" "}
            <code className="font-mono text-[11px]">~/.notebooklm/storage_state.json</code> y
            copia <strong className="font-medium">todo</strong> su contenido (JSON). Opcional: una
            sola línea con{" "}
            <code className="font-mono text-[11px]">jq -c . &lt; ~/.notebooklm/storage_state.json</code>
            .
          </li>
          <li>
            En <strong className="font-medium">Railway</strong> → servicio del backend →{" "}
            <strong className="font-medium">Variables</strong> → crea{" "}
            <code className="rounded bg-amber-100 px-1 font-mono text-[11px]">
              NOTEBOOKLM_AUTH_JSON
            </code>{" "}
            y pega el JSON. Trátalo como una contraseña.
          </li>
          <li>
            <strong className="font-medium">Redeploy</strong> el servicio. Cuando las cookies
            caduquen, repite login local y actualiza la variable.
          </li>
        </ol>
      ) : null}
    </div>
  );
}
