export const NO_FOIL_COLOR = '无颜色（纯彩印）';
export const MAX_ORDER_ITEM_FOIL_COLORS = 5;

export function formatFoilColors(
  colors: readonly string[] | null | undefined,
  empty = '—',
): string {
  return colors && colors.length > 0 ? colors.join('、') : empty;
}
