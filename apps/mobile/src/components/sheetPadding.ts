/** The padding a sheet's own style asks for, in the order React Native resolves it. */
interface PaddingStyle {
  padding?: unknown;
  paddingVertical?: unknown;
  paddingBottom?: unknown;
}

/**
 * A sheet's bottom padding: what its style asks for, plus the home-indicator inset.
 *
 * This is what `SafeAreaView edges={['bottom']}` did for the sheets before the panel became
 * an animated view (SheetSurface.tsx): it adds the inset to the style's padding instead of
 * replacing it, so a sheet keeps its own breathing room above the indicator.
 *
 * A percentage padding cannot be added to a number; none of the sheets uses one, and it is
 * read as no padding rather than guessed at.
 */
export function sheetBottomPadding(style: PaddingStyle | undefined, inset: number): number {
  const own = style?.paddingBottom ?? style?.paddingVertical ?? style?.padding;
  return (typeof own === 'number' ? own : 0) + inset;
}
