type SearchableValue = string | null | undefined;

type Ranked<T> = {
  row: T;
  rank: number;
  index: number;
};

function normalize(v: string): string {
  return v.trim().toLocaleLowerCase();
}

function fieldRank(value: SearchableValue, query: string): number {
  if (!value) return 100;
  const v = normalize(value);
  if (!v) return 100;
  if (v === query) return 0;
  if (v.startsWith(query)) return 1;
  if (v.includes(query)) return 2;
  return 100;
}

export function searchRelevanceRank(
  q: string | null | undefined,
  fields: readonly SearchableValue[],
  pinyinFields: readonly SearchableValue[] = [],
): number {
  const query = q ? normalize(q) : '';
  if (!query) return 0;

  let best = 100;
  for (const field of fields) {
    best = Math.min(best, fieldRank(field, query));
  }
  for (const field of pinyinFields) {
    const rank = fieldRank(field, query);
    best = Math.min(best, rank >= 100 ? rank : rank + 3);
  }
  return best;
}

export function sortBySearchRelevance<T>(
  rows: readonly T[],
  q: string | null | undefined,
  fieldsFor: (row: T) => {
    fields: readonly SearchableValue[];
    pinyinFields?: readonly SearchableValue[];
  },
): T[] {
  const query = q ? normalize(q) : '';
  if (!query) return [...rows];

  return rows
    .map<Ranked<T>>((row, index) => {
      const fields = fieldsFor(row);
      return {
        row,
        index,
        rank: searchRelevanceRank(query, fields.fields, fields.pinyinFields),
      };
    })
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ row }) => row);
}
