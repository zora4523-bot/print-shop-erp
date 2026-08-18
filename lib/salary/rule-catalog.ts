// Client-safe salary rule metadata.  Keep this module free of Prisma, db and
// Node-only imports: the interactive owner form imports it into the browser
// bundle, while rule-admin.ts owns all persistence and enum mapping.

export const SALARY_RULE_KEYS = [
  'CS_BASE_SALARY',
  'CS_PERIOD_LENGTH',
  'CS_TIERS',
  'PACKER_HOURLY',
  'CLEANER_HOURLY',
  'COOK_SPARE_HOURLY',
  'OT_MULTIPLIER',
  'WORK_HOURS',
  'COOK_MONTHLY',
] as const;

export type SalaryRuleKey = (typeof SALARY_RULE_KEYS)[number];

export type SalaryRuleValue =
  | { monthlyBase: number }
  | { months: number }
  | { mode: 'FLAT'; tiers: Array<{ minSales: number; rate: number }> }
  | { hourlyRate: number }
  | { multiplier: number }
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
    key: 'PACKER_HOURLY',
    label: '打包工时薪',
    description: '工厂支付给打包员工的正常工时时薪。',
  },
  {
    key: 'CLEANER_HOURLY',
    label: '清废工时薪',
    description: '工厂支付给清废员工的正常工时时薪。',
  },
  {
    key: 'COOK_SPARE_HOURLY',
    label: '厨师兼职打包时薪',
    description: '厨师的空闲打包工时按此时薪计。',
  },
  {
    key: 'OT_MULTIPLIER',
    label: '时薪员工加班倍率',
    description: '加班工资 = 时薪 × 加班小时 × 此倍率。',
  },
  {
    key: 'WORK_HOURS',
    label: '标准工时与加班起点',
    description: '用于考勤录入提示和加班小时的计算口径。',
  },
  {
    key: 'COOK_MONTHLY',
    label: '厨师月固定工资',
    description: '工厂支付给厨师的月固定工资；兼职打包另按时薪计。',
  },
];
