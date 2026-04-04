/** Lunes de la semana que contiene `d` (hora local 00:00). */
export function startOfWeekMonday(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  return x;
}

/** Domingo 23:59:59.999 de la semana que empieza en `weekStartMonday`. */
export function endOfWeekSunday(weekStartMonday: Date): Date {
  const x = new Date(
    weekStartMonday.getFullYear(),
    weekStartMonday.getMonth(),
    weekStartMonday.getDate(),
    23,
    59,
    59,
    999,
  );
  x.setDate(x.getDate() + 6);
  return x;
}

/** Los 7 días Lun→Dom como fechas locales a medianoche. */
export function weekDayDates(weekStartMonday: Date): Date[] {
  const out: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(
      weekStartMonday.getFullYear(),
      weekStartMonday.getMonth(),
      weekStartMonday.getDate() + i,
      0,
      0,
      0,
      0,
    );
    out.push(d);
  }
  return out;
}
