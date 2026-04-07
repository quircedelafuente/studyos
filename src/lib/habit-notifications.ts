import { Capacitor } from "@capacitor/core";
import type { HabitDefinition } from "@/types/dashboard";
import { loadHabits } from "@/lib/habits-storage";
import { todayYmdLocal, mondayYmdLocal } from "@/lib/daily-checklist-storage";
import { loadHabitLogsFile } from "@/lib/habit-logs-storage";
import { isHabitLogDone, periodKeyForHabitToday } from "@/lib/habits-schedule";

function isCapacitorIos(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
}

function notifIdForHabit(habitId: string, weekday: number): number {
  // Determinístico y estable: hash simple base 1000 + weekday.
  // Ojo: iOS requiere int32 positivo.
  let acc = 0;
  for (let i = 0; i < habitId.length; i++) acc = (acc * 31 + habitId.charCodeAt(i)) >>> 0;
  const base = (acc % 1_000_000) + 10_000;
  return base * 10 + (weekday % 7);
}

function parseTimeLocal(hhmm: string): { hour: number; minute: number } | null {
  if (typeof hhmm !== "string") return null;
  const m = hhmm.match(/^(\d{2}):(\d{2})$/);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

export async function ensureHabitNotificationPermissionIos(): Promise<boolean> {
  if (!isCapacitorIos()) return false;
  const { LocalNotifications } = await import("@capacitor/local-notifications");
  const perm = await LocalNotifications.checkPermissions();
  if (perm.display === "granted") return true;
  const req = await LocalNotifications.requestPermissions();
  return req.display === "granted";
}

export async function rescheduleHabitRemindersIos(habits: HabitDefinition[] = loadHabits()): Promise<void> {
  if (!isCapacitorIos()) return;
  const { LocalNotifications } = await import("@capacitor/local-notifications");
  const ok = await ensureHabitNotificationPermissionIos();
  if (!ok) return;

  // Cancelar las existentes que controlamos (by id determinístico)
  // No hay namespace -> cancelAll sería agresivo. Así que cancelamos por lista de ids.
  const toCancel: number[] = [];
  for (const h of habits) {
    if (!h.reminder?.enabled) continue;
    if (h.schedule.mode === "weekdays") {
      for (const wd of h.schedule.weekdays) toCancel.push(notifIdForHabit(h.id, wd));
    } else {
      // times/week: una notificación diaria (0..6)
      for (let wd = 0; wd < 7; wd++) toCancel.push(notifIdForHabit(h.id, wd));
    }
  }
  if (toCancel.length) {
    await LocalNotifications.cancel({ notifications: toCancel.map((id) => ({ id })) });
  }

  const logs = loadHabitLogsFile();
  const todayKey = todayYmdLocal();
  const weekKey = mondayYmdLocal();

  const toSchedule: any[] = [];
  for (const h of habits) {
    const r = h.reminder;
    if (!r?.enabled) continue;
    const tm = parseTimeLocal(r.timeLocal);
    if (!tm) continue;

    const message = (r.message ?? "").trim();
    const body = message || `Recordatorio: ${h.title}`;

    if (h.schedule.mode === "weekdays") {
      for (const wd of h.schedule.weekdays) {
        toSchedule.push({
          id: notifIdForHabit(h.id, wd),
          title: h.title,
          body,
          schedule: { on: { weekday: wd + 1, hour: tm.hour, minute: tm.minute }, repeats: true },
        });
      }
    } else {
      // times/week: estrategia v1 -> notificación diaria, pero se puede cancelar sola si ya está completado
      const pk = periodKeyForHabitToday(h);
      const done = isHabitLogDone(h, logs.byPeriod[pk]?.[h.id]);
      if (done) continue;
      for (let wd = 0; wd < 7; wd++) {
        toSchedule.push({
          id: notifIdForHabit(h.id, wd),
          title: h.title,
          body,
          schedule: { on: { weekday: wd + 1, hour: tm.hour, minute: tm.minute }, repeats: true },
        });
      }
    }
  }

  if (toSchedule.length) {
    await LocalNotifications.schedule({ notifications: toSchedule });
  }
}

