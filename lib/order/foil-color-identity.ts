import { foilColorFromLabel } from './foil-colors';

/** Compare known color aliases without rewriting saved order or inventory facts. */
export function foilColorIdentity(value: string): string {
  const name = foilColorFromLabel(value.trim());
  return name === '哑金' ? '亚金' : name;
}

export function hasDuplicateFoilColors(colors: readonly string[]): boolean {
  return new Set(colors.map(foilColorIdentity)).size !== colors.length;
}

/** Keep the first stored spelling and the user's printing order. */
export function uniqueFoilColors(colors: readonly string[]): string[] {
  const seen = new Set<string>();
  return colors.filter((color) => {
    const key = foilColorIdentity(color);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

type FoilCatalogEntry = {
  name: string;
  displayImage: string | null;
  displayColor: string | null;
};

function swatchPriority(option: FoilCatalogEntry): number {
  return (option.name === foilColorIdentity(option.name) ? 4 : 0)
    + (option.displayImage?.trim() ? 2 : 0)
    + (option.displayColor?.trim() ? 1 : 0);
}

/** A stock SKU is not an order color: project one swatch per color, without writes. */
export function orderFoilColorOptions<T extends FoilCatalogEntry>(options: readonly T[]): T[] {
  const chosen = new Map<string, T>();
  for (const option of options) {
    const key = foilColorIdentity(option.name);
    const previous = chosen.get(key);
    if (!previous || swatchPriority(option) > swatchPriority(previous)) {
      chosen.set(key, option);
    }
  }
  // Preserve the configured order of the chosen rows, including custom colors.
  return options.filter((option) => chosen.get(foilColorIdentity(option.name)) === option);
}
