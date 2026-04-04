export type DayCell = {
  date: Date;
  inMonth: boolean;
  day: number;
};

/** Semana que empieza en lunes. `monthIndex0` = 0 enero … 11 diciembre. */
export function monthGrid(year: number, monthIndex0: number): DayCell[] {
  const first = new Date(year, monthIndex0, 1);
  const last = new Date(year, monthIndex0 + 1, 0);
  const jsDow = first.getDay();
  const mondayFirstPad = (jsDow + 6) % 7;

  const cells: DayCell[] = [];
  const prevLast = new Date(year, monthIndex0, 0).getDate();
  for (let i = mondayFirstPad - 1; i >= 0; i--) {
    const d = prevLast - i;
    cells.push({
      date: new Date(year, monthIndex0 - 1, d),
      inMonth: false,
      day: d,
    });
  }
  for (let d = 1; d <= last.getDate(); d++) {
    cells.push({
      date: new Date(year, monthIndex0, d),
      inMonth: true,
      day: d,
    });
  }
  const rem = cells.length % 7;
  const nextPad = rem === 0 ? 0 : 7 - rem;
  for (let i = 1; i <= nextPad; i++) {
    cells.push({
      date: new Date(year, monthIndex0 + 1, i),
      inMonth: false,
      day: i,
    });
  }
  return cells;
}
