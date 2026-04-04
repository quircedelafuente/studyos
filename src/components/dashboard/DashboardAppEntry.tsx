"use client";

import dynamic from "next/dynamic";

const DashboardApp = dynamic(
  () => import("@/components/dashboard/DashboardApp").then((m) => m.DashboardApp),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-dvh items-center justify-center bg-[var(--canvas)] text-sm text-[var(--ink-muted)]">
        Cargando…
      </div>
    ),
  },
);

export function DashboardAppEntry() {
  return <DashboardApp />;
}
