export type SortDirection = 'asc' | 'desc';

export type PaginatedResult<T> = {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

type SearchParamValue = string | string[] | undefined;

export type TableHrefParams = Record<
  string,
  string | number | null | undefined
>;

export function firstSearchParam(value: SearchParamValue): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

export function parsePositiveInt(
  value: SearchParamValue,
  {
    defaultValue,
    min = 1,
    max = Number.MAX_SAFE_INTEGER,
  }: { defaultValue: number; min?: number; max?: number },
): number {
  const raw = firstSearchParam(value).trim();
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.min(Math.max(parsed, min), max);
}

export function parseSortDirection(
  value: SearchParamValue,
  fallback: SortDirection = 'asc',
): SortDirection {
  return firstSearchParam(value) === 'desc' ? 'desc' : fallback;
}

export function parseSortKey<T extends string>(
  value: SearchParamValue,
  allowed: readonly T[],
  fallback: T,
): T {
  const raw = firstSearchParam(value);
  return allowed.includes(raw as T) ? (raw as T) : fallback;
}

export function nextSortDirection<T extends string>(
  currentKey: T,
  currentDirection: SortDirection,
  targetKey: T,
): SortDirection {
  return currentKey === targetKey && currentDirection === 'asc' ? 'desc' : 'asc';
}

export function paginateItems<T>(
  items: readonly T[],
  page: number,
  pageSize: number,
): PaginatedResult<T> {
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(page, 1), pageCount);
  const start = (safePage - 1) * pageSize;
  return {
    rows: items.slice(start, start + pageSize),
    total,
    page: safePage,
    pageSize,
    pageCount,
  };
}

export function buildTableHref(
  basePath: string,
  current: TableHrefParams,
  updates: TableHrefParams,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...current, ...updates })) {
    if (value === null || value === undefined || value === '') continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}
