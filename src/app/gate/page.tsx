"use client";

import { useMemo, useState } from "react";

export default function GatePage() {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const disabled = useMemo(() => loading || password.trim().length === 0, [loading, password]);

  async function submit() {
    const pw = password;
    if (!pw.trim()) return;
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch("/api/app-gate/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      if (res.ok) {
        setMsg("Listo. Acceso concedido.");
        window.location.href = "/";
        return;
      }
      const j = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
      setMsg(j.detail || j.error || `Error (${res.status})`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error de red");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[var(--canvas)] flex items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <h1 className="text-lg font-extrabold text-[var(--ink)]">Acceso restringido</h1>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">Introduce el código para entrar.</p>

        <div className="mt-4 space-y-3">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Código de acceso"
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--canvas)] px-3 py-2 text-base text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:border-[var(--ink)] focus:outline-none sm:text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
            autoFocus
          />
          <button
            type="button"
            onClick={() => void submit()}
            disabled={disabled}
            className="w-full rounded-xl bg-[var(--ink)] px-4 py-2.5 text-sm font-extrabold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Entrando…" : "Entrar"}
          </button>
          {msg ? <p className="text-xs font-semibold text-[var(--ink-muted)]">{msg}</p> : null}
        </div>
      </div>
    </main>
  );
}

