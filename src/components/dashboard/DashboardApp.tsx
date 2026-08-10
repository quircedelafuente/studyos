"use client";

import { useSession, signOut } from "next-auth/react";
import { ThemeToggle } from "@/components/dashboard/ThemeToggle";
import { SectionsSettingsModal } from "@/components/dashboard/SectionsSettingsModal";
import {
  hiddenSectionsSnapshot,
  loadHiddenSections,
  subscribeToSections,
} from "@/lib/section-visibility";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Capacitor } from "@capacitor/core";
import { useStudyArena } from "@/components/study-arena/StudyArenaProvider";
import type { MainTabId } from "@/types/dashboard";
import {
  STUDY_PLANNER_NAV_EVENT,
  type StudyPlannerNavDetail,
} from "@/lib/study-planner-nav";
import { AssignmentsPanel } from "./AssignmentsPanel";
import { CalendarPanel } from "./CalendarPanel";
import { NotebookLMPanel } from "./NotebookLMPanel";
import { DeadlinesPanel } from "./DeadlinesPanel";
import { DashboardOverviewPanel } from "./DashboardOverviewPanel";
import { StudyPlannerPanel } from "./StudyPlannerPanel";
import { HabitTrackerPanel } from "./HabitTrackerPanel";
import { StudyArenaPanel } from "@/components/study-arena/StudyArenaPanel";
import { AppBlockingPanel } from "@/components/app-blocking/AppBlockingPanel";
import {
  IconAppBlocking,
  IconAssignments,
  IconDashboard,
  IconCalendar,
  IconChecklist,
  IconClassNotes,
  IconDeadlines,
  IconFolder,
  IconMenu,
  IconSettings,
  IconNotes,
  IconStudyPlanner,
  IconStudyArena,
  IconTerminal,
  IconX,
} from "./icons";
import { ClassNotesPanel } from "./ClassNotesPanel";
import { DailyTasksPanel } from "./DailyTasksPanel";
import { NotesPanel } from "./NotesPanel";

const BASE_TABS: {
  id: MainTabId;
  label: string;
  Icon: typeof IconCalendar;
  iosOnly?: boolean;
}[] = [
  { id: "dashboard",     label: "Dashboard",        Icon: IconDashboard },
  { id: "calendario",    label: "Calendario",        Icon: IconCalendar },
  { id: "class-notes",   label: "Class Notes",       Icon: IconClassNotes },
  { id: "fechas",        label: "Exámenes y fechas", Icon: IconDeadlines },
  { id: "daily-tasks",   label: "Tareas",            Icon: IconChecklist },
  { id: "habits",        label: "Habit Tracker",     Icon: IconChecklist },
  { id: "assignments",   label: "Assignments",       Icon: IconAssignments },
  { id: "study-planner", label: "Study Planner",     Icon: IconStudyPlanner },
  { id: "study-arena",   label: "Study Arena",       Icon: IconStudyArena },
  { id: "notas",         label: "Notas",             Icon: IconNotes },
  { id: "notebooklm",    label: "NotebookLM",        Icon: IconTerminal },
  { id: "app-blocking",  label: "Bloqueo de Apps",   Icon: IconAppBlocking, iosOnly: true },
];

export function DashboardApp() {
  const [mainTab, setMainTab] = useState<MainTabId>("calendario");
  /** Intención de navegación hacia Study Planner (se mantiene unos ms para montajes dobles en dev). */
  const [studyPlannerNavCreateDeadlineId, setStudyPlannerNavCreateDeadlineId] = useState<
    string | null
  >(null);
  const [studyPlannerNavOpenPlanId, setStudyPlannerNavOpenPlanId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sectionsSettingsOpen, setSectionsSettingsOpen] = useState(false);
  /** Serializado, para que useSyncExternalStore pueda comparar por valor. */
  const hiddenRaw = useSyncExternalStore(
    subscribeToSections,
    hiddenSectionsSnapshot,
    () => "[]",
  );
  const hiddenSections = useMemo(() => loadHiddenSections(), [hiddenRaw]);
  const [isMdUp, setIsMdUp] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(min-width: 768px)").matches
      : false,
  );
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

  /** En viewport móvil no se ofrece Bloqueo de apps (sigue en tablet/escritorio). */
  const navTabs = useMemo(() => {
    const base = isMdUp
      ? MAIN_TABS
      : MAIN_TABS.filter((t) => t.id !== "app-blocking");
    return base.filter((t) => !hiddenSections.has(t.id));
  }, [MAIN_TABS, isMdUp, hiddenSections]);

  /**
   * Sección realmente mostrada. Se deriva en vez de corregirse con un efecto:
   * si ocultas la sección que tienes abierta, se cae a la primera visible sin
   * escribir estado durante el render.
   */
  const activeTab: MainTabId = hiddenSections.has(mainTab)
    ? (navTabs[0]?.id ?? "dashboard")
    : mainTab;

  /** iPhone / iOS estrecho: menú hamburguesa → modal a pantalla completa (no drawer). */
  const iosMobileFullscreenMenu = isIOS && !isMdUp;

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const apply = () => setIsMdUp(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    setSuppressFloatingWidget(activeTab === "study-arena");
    return () => setSuppressFloatingWidget(false);
  }, [activeTab, setSuppressFloatingWidget]);

  useEffect(() => {
    if (!sidebarOpen || !iosMobileFullscreenMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSidebarOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sidebarOpen, iosMobileFullscreenMenu]);

  useEffect(() => {
    if (!isMdUp && activeTab === "app-blocking") {
      setMainTab("calendario");
    }
  }, [isMdUp, activeTab]);

  useEffect(() => {
    function onStudyPlannerNav(e: Event) {
      const ce = e as CustomEvent<StudyPlannerNavDetail>;
      const d = ce.detail;
      if (!d) return;
      if (d.mode === "create") {
        setStudyPlannerNavCreateDeadlineId(d.deadlineId);
        setStudyPlannerNavOpenPlanId(null);
      } else {
        setStudyPlannerNavOpenPlanId(d.planId);
        setStudyPlannerNavCreateDeadlineId(null);
      }
      setMainTab("study-planner");
      setSidebarOpen(false);
    }
    window.addEventListener(STUDY_PLANNER_NAV_EVENT, onStudyPlannerNav as EventListener);
    return () =>
      window.removeEventListener(STUDY_PLANNER_NAV_EVENT, onStudyPlannerNav as EventListener);
  }, []);

  useEffect(() => {
    if (activeTab !== "study-planner") return;
    if (!studyPlannerNavCreateDeadlineId && !studyPlannerNavOpenPlanId) return;
    const t = window.setTimeout(() => {
      setStudyPlannerNavCreateDeadlineId(null);
      setStudyPlannerNavOpenPlanId(null);
    }, 600);
    return () => window.clearTimeout(t);
  }, [activeTab, studyPlannerNavCreateDeadlineId, studyPlannerNavOpenPlanId]);

  const closeSidebar = () => setSidebarOpen(false);

  return (
    <div className="flex h-dvh max-h-dvh min-h-0 min-w-0 overflow-x-hidden bg-[var(--canvas)] text-[var(--ink)]">
      {sidebarOpen && !iosMobileFullscreenMenu ? (
        <button
          type="button"
          aria-label="Cerrar menú"
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={closeSidebar}
        />
      ) : null}

      {sidebarOpen && iosMobileFullscreenMenu ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Navegación"
          className="fixed inset-0 z-[70] flex flex-col bg-[var(--canvas)] text-[var(--ink)]"
        >
          <div className="flex shrink-0 items-center px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 pl-[max(0.75rem,env(safe-area-inset-left))]">
            <button
              type="button"
              onClick={closeSidebar}
              aria-label="Cerrar menú"
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-[var(--ink)] active:bg-[var(--surface-muted)]"
            >
              <IconX className="h-7 w-7" />
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <div className="mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col px-4 py-2">
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center">
                <nav
                  className="flex w-full flex-col gap-1.5 text-center"
                  aria-label="Secciones"
                >
                  {navTabs.map(({ id, label, Icon }) => {
                    const active = activeTab === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => {
                          setMainTab(id);
                          closeSidebar();
                        }}
                        className={`flex min-h-[40px] w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold leading-snug transition ${
                          active
                            ? "bg-[var(--ink)] text-white shadow-md"
                            : "bg-[var(--surface)] text-[var(--ink)] shadow-sm ring-1 ring-[var(--border)] active:bg-[var(--surface-muted)]"
                        }`}
                      >
                        <Icon className="h-[1.1rem] w-[1.1rem] shrink-0 opacity-90" />
                        <span className="line-clamp-2">{label}</span>
                      </button>
                    );
                  })}
                </nav>
              </div>
              <div className="mt-4 shrink-0 border-t border-[var(--border)] pt-4 pb-2">
                <button
                  type="button"
                  onClick={() => {
                    closeSidebar();
                    setSectionsSettingsOpen(true);
                  }}
                  className="mb-3 flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--ink)] transition active:bg-[var(--surface-muted)]"
                >
                  <IconSettings className="h-4 w-4 shrink-0" />
                  Ajustes de secciones
                </button>
                <div className="mb-3">
                  <ThemeToggle />
                </div>
                {status === "authenticated" && session?.user ? (
                  <div className="space-y-3 text-center">
                    <p className="truncate text-xs text-[var(--ink-muted)]">
                      {session.user.email ?? session.user.name}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        closeSidebar();
                        void signOut({ callbackUrl: "/" });
                      }}
                      className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-semibold text-[var(--ink)] transition active:bg-[var(--surface-muted)]"
                    >
                      Cerrar sesión
                    </button>
                  </div>
                ) : status === "loading" ? (
                  <p className="text-center text-xs text-[var(--ink-faint)]">Cargando sesión…</p>
                ) : (
                  <p className="text-center text-xs text-[var(--ink-faint)]">
                    Inicia sesión desde Calendario para sincronizar Google.
                  </p>
                )}
              </div>
            </div>
          </div>
          <div className="shrink-0 pb-[max(0.75rem,env(safe-area-inset-bottom))]" aria-hidden />
        </div>
      ) : null}

      <aside
        className={`${
          iosMobileFullscreenMenu
            ? "hidden md:flex"
            : "flex"
        } fixed left-0 top-0 z-50 h-dvh w-[17.5rem] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--sidebar)] transition-transform duration-200 ease-out md:static md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        } ${sidebarCollapsed ? "md:w-[4.75rem]" : "md:w-[17.5rem]"}`}
        aria-label="Navegación principal"
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2.5 md:px-4 md:py-4">
          <div className={sidebarCollapsed ? "hidden" : "block"}>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--ink-muted)] md:text-xs md:tracking-[0.2em]">
              IEStudio
            </p>
            <p className="mt-0.5 text-xs font-semibold text-[var(--ink)] md:text-sm">
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

        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2 md:gap-1 md:p-3">
          <p
            className={`mb-0.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--ink-faint)] md:mb-1 md:text-[11px] ${sidebarCollapsed ? "hidden" : "block"}`}
          >
            Secciones
          </p>
          {navTabs.map(({ id, label, Icon }) => {
            const active = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setMainTab(id);
                  closeSidebar();
                }}
                className={`flex min-h-[40px] w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium transition md:min-h-[44px] md:gap-3 md:rounded-xl md:px-3 md:py-3 md:text-sm ${
                  active
                    ? "bg-[var(--ink)] text-white"
                    : "text-[var(--ink-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"
                }`}
                title={sidebarCollapsed ? label : undefined}
              >
                <Icon className="h-[1.05rem] w-[1.05rem] shrink-0 opacity-90 md:h-5 md:w-5" />
                <span
                  className={`min-w-0 md:truncate ${sidebarCollapsed ? "hidden" : "inline line-clamp-2 md:line-clamp-none"}`}
                >
                  {label}
                </span>
              </button>
            );
          })}
        </nav>

        <div className={`border-t border-[var(--border)] p-3 ${sidebarCollapsed ? "hidden" : ""}`}>
          <button
            type="button"
            onClick={() => setSectionsSettingsOpen(true)}
            className="mb-3 flex w-full items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
          >
            <IconSettings className="h-4 w-4 shrink-0" />
            Ajustes de secciones
          </button>
          <div className="mb-3">
            <p className="mb-1.5 px-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--ink-faint)]">
              Tema
            </p>
            <ThemeToggle />
          </div>
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

      <SectionsSettingsModal
        open={sectionsSettingsOpen}
        onClose={() => setSectionsSettingsOpen(false)}
        sections={MAIN_TABS}
        hidden={hiddenSections}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:pl-0">
        <header className="z-30 flex items-center gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] shadow-sm md:hidden">
          <button
            type="button"
            className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-xl p-1.5 text-[var(--ink)] active:bg-[var(--surface-muted)] transition-colors"
            aria-label="Abrir menú"
            onClick={() => setSidebarOpen(true)}
          >
            <IconMenu className="h-6 w-6" />
          </button>
          <div className="min-w-0 flex flex-col leading-tight">
            <span className="truncate text-[10px] font-bold uppercase tracking-wider text-[var(--ink-faint)]">
              IEStudio
            </span>
            <span className="min-w-0 truncate text-xs font-bold text-[var(--ink)]">Dashboard</span>
          </div>
        </header>

        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {activeTab === "dashboard" ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto scroll-smooth pb-[env(safe-area-inset-bottom,0px)]">
              <DashboardOverviewPanel />
            </div>
          ) : null}
          {activeTab === "calendario" ? (
            <CalendarPanel />
          ) : null}
          {activeTab === "class-notes" ? (
            <div className="min-h-0 flex-1 overflow-y-auto md:flex md:flex-col md:overflow-hidden">
              <ClassNotesPanel />
            </div>
          ) : null}
          {activeTab === "fechas" ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              <DeadlinesPanel />
            </div>
          ) : null}
          {activeTab === "daily-tasks" ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              <DailyTasksPanel />
            </div>
          ) : null}
          {activeTab === "habits" ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              <HabitTrackerPanel />
            </div>
          ) : null}
          {activeTab === "assignments" ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              <AssignmentsPanel />
            </div>
          ) : null}
          {activeTab === "study-planner" ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              <StudyPlannerPanel
                navCreateDeadlineId={studyPlannerNavCreateDeadlineId}
                navOpenPlanId={studyPlannerNavOpenPlanId}
              />
            </div>
          ) : null}
          {activeTab === "study-arena" ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              <StudyArenaPanel />
            </div>
          ) : null}
          {activeTab === "notas" ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <NotesPanel />
            </div>
          ) : null}
          {activeTab === "notebooklm" ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <NotebookLMPanel />
            </div>
          ) : null}
          {activeTab === "app-blocking" && isMdUp ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              <AppBlockingPanel />
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}
