/** HTML5 drag payload: palette → canvas (add) or palette → node (replace). */
export const PALETTE_DND_MIME = "application/simulai-kind";

export function isPaletteDrag(dt: DataTransfer): boolean {
  return Array.from(dt.types).includes(PALETTE_DND_MIME);
}
