// Client-safe salary rule metadata.  Keep this module free of Prisma, db and
// Node-only imports: the interactive owner form imports it into the browser
// bundle, while rule-admin.ts owns all persistence and enum mapping.

export const SALARY_RULE_KEYS = [
  'CS_BASE_SALARY',
  'CS_PERIOD_LENGTH',
  'CS_TIERS',
  'WORK_HOURS',
] as const;

export type SalaryRuleKey = (typeof SALARY_RULE_KEYS)[number];

export type SalaryRuleValue =
  | { monthlyBase: number }
  | { months: number }
  | { mode: 'FLAT'; tiers: Array<{ minSales: number; rate: number }> }
  | {
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
    key: 'CS_BASE_SALARY',
    label: '内部客服月固定工资',
    description: '工厂支付给内部客服；周期创建时会锁定到周期记录。',
  },
  {
    key: 'CS_PERIOD_LENGTH',
    label: '内部客服结算周期',
    description: '按月设置；新建周期才会使用新规则。',
  },
  {
    key: 'CS_TIERS',
    label: '内部客服销售额提成档位',
    description: 'FLAT：达到的最高档比例作用于整个销售额。',
  },
  {
    key: 'WORK_HOURS',
    label: '标准工时与加班起点',
    description: '用于考勤录入提示和加班小时的计算口径。',
  },
];
