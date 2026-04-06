"use client";

import { useSession, signOut } from "next-auth/react";
import { useEffect, useMemo, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { useStudyArena } from "@/components/study-arena/StudyArenaProvider";
import type { MainTabId } from "@/types/dashboard";
import { AssignmentsPanel } from "./AssignmentsPanel";
import { CalendarPanel } from "./CalendarPanel";
import { NotebookLMPanel } from "./NotebookLMPanel";
import { CoursesPanel } from "./CoursesPanel";
import { DeadlinesPanel } from "./DeadlinesPanel";
import { DocumentsPanel } from "./DocumentsPanel";
import { DashboardOverviewPanel } from "./DashboardOverviewPanel";
import { StudyPlannerPanel } from "./StudyPlannerPanel";
import { StudyArenaPanel } from "@/components/study-arena/StudyArenaPanel";
import { AppBlockingPanel } from "@/components/app-blocking/AppBlockingPanel";
import {
  IconAppBlocking,
  IconAssignments,
  IconDashboard,
  IconCalendar,
  IconClassNotes,
  IconCourses,
  IconDeadlines,
  IconFolder,
  IconMenu,
  IconNotes,
  IconStudyPlanner,
  IconStudyArena,
  IconTerminal,
  IconX,
} from "./icons";
import { ClassNotesPanel } from "./ClassNotesPanel";
import { NotesPanel } from "./NotesPanel";

const BASE_TABS: {
  id: MainTabId;
  label: string;
  Icon: typeof IconCalendar;
  iosOnly?: boolean;
}[] = [
  { id: "dashboard",     label: "Dashboard",        Icon: IconDashboard },
  { id: "calendario",    label: "Calendario",        Icon: IconCalendar },
  { id: "courses",       label: "Courses",           Icon: IconCourses },
  { id: "class-notes",   label: "Class Notes",       Icon: IconClassNotes },
  { id: "fechas",        label: "Exámenes y fechas", Icon: IconDeadlines },
  { id: "documentos",    label: "Documentos",        Icon: IconFolder },
  { id: "assignments",   label: "Assignments",       Icon: IconAssignments },
  { id: "study-planner", label: "Study Planner",     Icon: IconStudyPlanner },
  { id: "study-arena",   label: "Study Arena",       Icon: IconStudyArena },
  { id: "notas",         label: "Notas",             Icon: IconNotes },
  { id: "notebooklm",    label: "NotebookLM",        Icon: IconTerminal },
  { id: "app-blocking",  label: "Bloqueo de Apps",   Icon: IconAppBlocking, iosOnly: true },
];

export function DashboardApp() {
  const [mainTab, setMainTab] = useState<MainTabId>("calendario");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { data: session, status } = useSession();
  const { setSuppressFloatingWidget } = useStudyArena();

  const isIOS = useMemo(
    () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios",
    [],
  );
  const MAIN_TABS = useMemo(
    () => BASE_TABS.filter((t) => !t.iosOnly || isIOS),
    [isIOS],
  );

  useEffect(() => {
    setSuppressFloatingWidget(mainTab === "study-arena");
    return () => setSuppressFloatingWidget(false);
  }, [mainTab, setSuppressFloatingWidget]);

  const closeSidebar = () => setSidebarOpen(false);

  return (
    <div className="flex h-dvh max-h-dvh min-h-0 min-w-0 overflow-x-hidden bg-[var(--canvas)] text-[var(--ink)]">
      {sidebarOpen ? (
        <button
          type="button"
          aria-label="Cerrar menú"
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={closeSidebar}
        />
      ) : null}

      <aside
        className={`fixed left-0 top-0 z-50 flex h-dvh w-[17.5rem] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--sidebar)] transition-transform duration-200 ease-out md:static md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        } ${sidebarCollapsed ? "md:w-[4.75rem]" : "md:w-[17.5rem]"}`}
        aria-label="Navegación principal"
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-4">
          <div className={sidebarCollapsed ? "hidden" : "block"}>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
              IEStudio
            </p>
            <p className="mt-0.5 text-sm font-semibold text-[var(--ink)]">
              Panel
            </p>
          </div>
          <button
            type="button"
            className="hidden rounded-lg p-2 text-[var(--ink-muted)] hover:bg-[var(--surface-muted)] md:inline-flex"
            onClick={() => setSidebarCollapsed((v) => !v)}
            aria-label={sidebarCollapsed ? "Expandir menú" : "Minimizar menú"}
            title={sidebarCollapsed ? "Expandir menú" : "Minimizar menú"}
          >
            <IconMenu className="h-5 w-5" />
          </button>
          <button
            type="button"
            className="rounded-lg p-2 text-[var(--ink-muted)] hover:bg-[var(--surface-muted)] md:hidden"
            onClick={closeSidebar}
            aria-label="Cerrar"
          >
            <IconX className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
          <p className={`mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-faint)] ${sidebarCollapsed ? "hidden" : "block"}`}>
            Secciones
          </p>
          {MAIN_TABS.map(({ id, label, Icon }) => {
            const active = mainTab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setMainTab(id);
                  closeSidebar();
                }}
                className={`flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium transition ${
                  active
                    ? "bg-[var(--ink)] text-white"
                    : "text-[var(--ink-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"
                }`}
                title={sidebarCollapsed ? label : undefined}
              >
                <Icon className="h-5 w-5 shrink-0 opacity-90" />
                <span className={sidebarCollapsed ? "hidden" : "inline"}>{label}</span>
              </button>
            );
          })}
        </nav>

        <div className={`border-t border-[var(--border)] p-3 ${sidebarCollapsed ? "hidden" : ""}`}>
          {status === "authenticated" && session?.user ? (
            <div className="space-y-2">
              <p className="truncate px-2 text-xs text-[var(--ink-muted)]">
                {session.user.email ?? session.user.name}
              </p>
              <button
                type="button"
                onClick={() => signOut({ callbackUrl: "/" })}
                className="w-full rounded-xl border border-[var(--border)] px-3 py-2 text-center text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
              >
                Cerrar sesión
              </button>
            </div>
          ) : status === "loading" ? (
            <p className="px-2 text-xs text-[var(--ink-faint)]">Cargando sesión…</p>
          ) : (
            <p className="px-2 text-xs text-[var(--ink-faint)]">
              Inicia sesión desde Calendario para sincronizar Google.
            </p>
          )}
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:pl-0">
        <header className="flex items-center gap-3 border-[var(--border)] bg-[var(--surface)] px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] md:hidden border-b shadow-sm z-30">
          <button
            type="button"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl p-2 text-[var(--ink)] active:bg-[var(--surface-muted)] transition-colors"
            aria-label="Abrir menú"
            onClick={() => setSidebarOpen(true)}
          >
            <IconMenu className="h-6 w-6" />
          </button>
          <div className="flex flex-col min-w-0">
            <span className="truncate text-xs font-bold uppercase tracking-widest text-[var(--ink-faint)]">IEStudio</span>
            <span className="min-w-0 truncate text-sm font-black -mt-0.5">Dashboard</span>
          </div>
        </header>

        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {mainTab === "dashboard" ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto scroll-smooth pb-[env(safe-area-inset-bottom,0px)]">
              <DashboardOverviewPanel />
            </div>
          ) : null}
          {mainTab === "calendario" ? (
            <CalendarPanel />
          ) : null}
          {mainTab === "courses" ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              <CoursesPanel />
            </div>
          ) : null}
          {mainTab === "class-notes" ? (
            <ClassNotesPanel />
          ) : null}
          {mainTab === "fechas" ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              <DeadlinesPanel />
            </div>
          ) : null}
          {mainTab === "documentos" ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <DocumentsPanel />
            </div>
          ) : null}
          {mainTab === "assignments" ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              <AssignmentsPanel />
            </div>
          ) : null}
          {mainTab === "study-planner" ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              <StudyPlannerPanel />
            </div>
          ) : null}
          {mainTab === "study-arena" ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              <StudyArenaPanel />
            </div>
          ) : null}
          {mainTab === "notas" ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <NotesPanel />
            </div>
          ) : null}
          {mainTab === "notebooklm" ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <NotebookLMPanel />
            </div>
          ) : null}
          {mainTab === "app-blocking" ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              <AppBlockingPanel />
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}
