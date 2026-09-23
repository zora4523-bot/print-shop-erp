// 现行纸张叫法与建单展示顺序（业主 2026-09-23，DECISIONS 同日）。
// 只影响显示：库里的纸张名称、计价键和历史价格都保持原样，所以每个
// 展示纸张的地方都要经过 paperDisplayLabel，不能直接改存储值。

const PAPER_TERMS: ReadonlyArray<readonly [RegExp, string]> = [
  [/珠光(?:闪红|暗红)/gu, '暗红珠光纸'],
  [/珠光艳闪/gu, '艳红珠光纸'],
  [/金葱(?!纸)/gu, '金葱纸'],
  // 「红卡盒子」是包装盒型，不是纸张。
  [/红卡(?![纸盒])/gu, '红卡纸'],
  [/冰白纸/gu, '冰白珠光纸'],
  // 业主保留「160g杂色珠光」（带专版 +0.03），重复的「160g杂色珠光纸」已停用。
  [/杂色珠光(?!纸)/gu, '杂色珠光纸'],
];

/** Current paper terminology; persisted catalog facts and historical prices keep their identity. */
export function paperDisplayLabel(label: string): string {
  return PAPER_TERMS.reduce((text, [pattern, term]) => text.replace(pattern, term), label);
}

// Search runs against stored names, but users type what the screen shows.
const STORED_PAPER_TERMS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['暗红珠光纸', ['珠光闪红', '珠光暗红']],
  ['艳红珠光纸', ['珠光艳闪']],
  ['金葱纸', ['金葱']],
  ['红卡纸', ['红卡']],
  ['冰白珠光纸', ['冰白纸']],
  ['杂色珠光纸', ['杂色珠光']],
];

/** The typed text plus the stored spellings it may refer to, for contains-matching. */
export function paperSearchValues(query: string): string[] {
  const values = new Set([query]);
  for (const [display, stored] of STORED_PAPER_TERMS) {
    if (!query.includes(display)) continue;
    for (const name of stored) values.add(query.replaceAll(display, name));
  }
  return [...values];
}

/**
 * 建单纸张按钮的顺序（按显示名）。尚未建档的纸张先占位，建好物料和价格后
 * 自动排到这里；清单外的纸张排在最后并保持原有相对顺序。
 */
export const PAPER_DISPLAY_ORDER: readonly string[] = [
  '艳红珠光纸',
  '暗红珠光纸',
  '触感纸',
  '金葱纸',
  '红卡纸',
  '米金珠光纸',
  '紫色珠光纸',
  '黄色珠光纸',
  '粉色珠光纸',
  '金色珠光纸',
  '玫红珠光纸',
  '杂色珠光纸',
  '暗紫珠光纸',
  '紫色红珠光纸',
  '冰白珠光纸',
  '铜版纸',
];

/** Position of a displayed paper label; unlisted papers share the last rank. */
export function paperDisplayRank(label: string): number {
  const index = PAPER_DISPLAY_ORDER.indexOf(label);
  return index < 0 ? PAPER_DISPLAY_ORDER.length : index;
}
