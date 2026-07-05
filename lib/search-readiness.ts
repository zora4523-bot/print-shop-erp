import { db } from './db';

type RawSearchIndexReadiness = {
  surfaceKey: string;
  routePath: string;
  businessArea: string;
  sampleQuery: string;
  requiredExtensions: string[] | null;
  optionalExtensions: string[] | null;
  requiredIndexes: string[] | null;
  optionalIndexes: string[] | null;
  missingRequiredExtensions: string[] | null;
  missingOptionalExtensions: string[] | null;
  missingRequiredIndexes: string[] | null;
  missingOptionalIndexes: string[] | null;
  readyForSearch: boolean;
  blockers: string[] | null;
  explainSql: string;
  priority: number;
  rationale: string;
};

export type SearchIndexReadiness = Omit<
  RawSearchIndexReadiness,
  | 'requiredExtensions'
  | 'optionalExtensions'
  | 'requiredIndexes'
  | 'optionalIndexes'
  | 'missingRequiredExtensions'
  | 'missingOptionalExtensions'
  | 'missingRequiredIndexes'
  | 'missingOptionalIndexes'
  | 'blockers'
> & {
  requiredExtensions: string[];
  optionalExtensions: string[];
  requiredIndexes: string[];
  optionalIndexes: string[];
  missingRequiredExtensions: string[];
  missingOptionalExtensions: string[];
  missingRequiredIndexes: string[];
  missingOptionalIndexes: string[];
  blockers: string[];
};

export async function listSearchIndexReadiness(): Promise<
  SearchIndexReadiness[]
> {
  const rows = await db.$queryRaw<RawSearchIndexReadiness[]>`
    SELECT
      surface_key AS "surfaceKey",
      route_path AS "routePath",
      business_area AS "businessArea",
      sample_query AS "sampleQuery",
      required_extensions AS "requiredExtensions",
      optional_extensions AS "optionalExtensions",
      required_indexes AS "requiredIndexes",
      optional_indexes AS "optionalIndexes",
      missing_required_extensions AS "missingRequiredExtensions",
      missing_optional_extensions AS "missingOptionalExtensions",
      missing_required_indexes AS "missingRequiredIndexes",
      missing_optional_indexes AS "missingOptionalIndexes",
      ready_for_search AS "readyForSearch",
      blockers,
      explain_sql AS "explainSql",
      priority,
      rationale
    FROM app_ops.search_index_readiness
    ORDER BY priority ASC, surface_key ASC
  `;

  return rows.map((row) => ({
    ...row,
    requiredExtensions: row.requiredExtensions ?? [],
    optionalExtensions: row.optionalExtensions ?? [],
    requiredIndexes: row.requiredIndexes ?? [],
    optionalIndexes: row.optionalIndexes ?? [],
    missingRequiredExtensions: row.missingRequiredExtensions ?? [],
    missingOptionalExtensions: row.missingOptionalExtensions ?? [],
    missingRequiredIndexes: row.missingRequiredIndexes ?? [],
    missingOptionalIndexes: row.missingOptionalIndexes ?? [],
    blockers: row.blockers ?? [],
  }));
}
