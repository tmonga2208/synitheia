/**
 * "Saturday, November 14" as a heading's two lines: the weekday over the date.
 *
 * A past day's screen is headed the way Today is, a small line over a large one. The label
 * comes ready-made from `formatDayLabel`, so it is split here rather than formatted twice
 * and risked disagreeing with itself.
 */
export function splitDayLabel(label: string): [weekday: string | undefined, date: string] {
  const comma = label.indexOf(', ');
  if (comma === -1) return [undefined, label];
  return [label.slice(0, comma), label.slice(comma + 2)];
}
