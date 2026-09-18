export const NO_FOIL_COLOR = '无颜色（纯彩印）';
export const MAX_ORDER_ITEM_FOIL_COLORS = 5;

/** Labels only: retain stored catalog names for pricing, ordering and history. */
const FOIL_COLOR_LABELS: Readonly<Record<string, string>> = {
  浅色: '浅金', 红色: '红金', 黑色: '黑金', 银色: '银金',
  蓝色: '蓝金', 透明色: '透明金', 绿色: '绿金',
};

export function foilColorLabel(color: string): string {
  return Object.hasOwn(FOIL_COLOR_LABELS, color) ? FOIL_COLOR_LABELS[color]! : color;
}

/** Inverse of foilColorLabel: a typed display name maps back to its stored catalog name. */
export function foilColorFromLabel(label: string): string {
  return Object.keys(FOIL_COLOR_LABELS).find((key) => FOIL_COLOR_LABELS[key] === label) ?? label;
}

/** Search both display names and legacy stored names without changing data. */
export function foilColorSearchValues(colors: readonly string[]): string[] {
  return [...new Set(colors.flatMap((color) => {
    const label = foilColorLabel(color);
    const aliases = Object.keys(FOIL_COLOR_LABELS).filter((key) => FOIL_COLOR_LABELS[key] === label);
    return [color, label, ...aliases];
  }))];
}

export function formatFoilColors(
  colors: readonly string[] | null | undefined,
  empty = '—',
): string {
  return colors && colors.length > 0 ? colors.map(foilColorLabel).join('、') : empty;
}

/** Keep delimiters while presenting editable historical color lists. */
export function foilColorInputLabel(text: string): string {
  return text.split(/([,，、])/).map((part) => foilColorLabel(part)).join('');
}

/**
 * Editing a label must retain a matching saved identity; a newly typed display
 * name resolves through the dictionary so it is stored as the catalog name.
 * Unknown names pass through.
 */
export function restoreFoilColorInput(text: string, saved: readonly string[]): string {
  return text.split(/([,，、])/).map((part) =>
    saved.find((color) => foilColorLabel(color) === part) ?? foilColorFromLabel(part),
  ).join('');
}
