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
            El backend en Railway necesita credenciales de NotebookLM en disco persistente.
            Suele requerir un volumen montado y ejecutar{" "}
            <code className="rounded bg-amber-100 px-1 font-mono text-[11px]">
              notebooklm login
            </code>{" "}
            en el contenedor o copiar los archivos de sesión; consulta la documentación de{" "}
            <code className="font-mono text-[11px]">notebooklm-py</code>.
          </>
        )}
      </p>
    </div>
  );
}
