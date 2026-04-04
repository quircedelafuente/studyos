"use client";

export function NotebookLMAuthBanner() {
  return (
    <div className="mx-4 mt-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 md:mx-10 md:mt-8">
      <p className="text-sm font-semibold text-amber-900">
        No se detectó sesión de NotebookLM
      </p>
      <p className="mt-1 text-xs text-amber-800">
        En terminal ejecuta primero{" "}
        <code className="font-mono-cli rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium">
          npm run notebooklm:login
        </code>{" "}
        para iniciar sesión con tu cuenta Google y luego{" "}
        <code className="font-mono-cli rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium">
          npm run notebooklm:backend
        </code>{" "}
        para arrancar el backend local.
      </p>
    </div>
  );
}
