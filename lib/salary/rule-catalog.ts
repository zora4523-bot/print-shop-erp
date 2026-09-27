// Client-safe salary rule metadata.  Keep this module free of Prisma, db and
// Node-only imports: the interactive owner form imports it into the browser
// bundle, while rule-admin.ts owns all persistence and enum mapping.

export const SALARY_RULE_KEYS = [
  'WORK_HOURS',
] as const;

export type SalaryRuleKey = (typeof SALARY_RULE_KEYS)[number];

export type SalaryRuleValue = {
  morning: { start: string; end: string };
  afternoon: { start: string; end: string };
  otStart: string;
};

export type SalaryRuleCatalogEntry = {
  key: SalaryRuleKey;
  label: string;
  description: string;
};

export const SALARY_RULE_CATALOG: readonly SalaryRuleCatalogEntry[] = [
  {
    key: 'WORK_HOURS',
    label: '标准工时与加班起点',
    description: '用于考勤录入提示和加班小时的计算口径。',
  },
];
