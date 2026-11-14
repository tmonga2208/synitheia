/**
 * Whether facts set side by side, with a separator between each pair, fit in a box.
 *
 * Widths are whole points as measured on screen. A line that is exactly as wide as the box
 * fits; one point over does not, since that point is where the last letter gets cut.
 */
export function fitsOnOneLine(box: number, parts: readonly number[], separator: number): boolean {
  const shown = parts.filter((width) => width > 0);
  const needed =
    shown.reduce((sum, width) => sum + width, 0) + separator * Math.max(0, shown.length - 1);
  return needed <= box;
}
