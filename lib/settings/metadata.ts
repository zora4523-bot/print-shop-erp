/**
 * 设置页客户端所需的纯元数据。
 *
 * 这个模块会被 `SettingsForm` 的 `use client` 边界引用，因此不得引入
 * Zod、数据库或任何服务端依赖。服务端 schema / fallback / remark 在
 * `./definitions.ts` 中补齐，并直接展开这里的元数据，避免表单约束漂移。
 */

export type SettingFieldSpec =
  | { kind: 'text'; name: string; maxLength: number }
  | { kind: 'int'; name: string; min: number; max: number; unit: string };

export type SettingMetadata = {
  label: string;
  help: string;
  field: SettingFieldSpec;
};

export const SETTING_METADATA = {
  factory_name: {
    label: '工厂名称',
    help: '打印工单和导出 PDF 的页眉抬头。',
    field: { kind: 'text', name: 'name', maxLength: 40 },
  },
  cdr_link_expire_hours: {
    label: 'CDR 下载链接有效期',
    help: '打包完成后签发的下载链接多久过期。只影响此后新签发的链接，已发出去的不受影响。',
    field: { kind: 'int', name: 'hours', min: 1, max: 168, unit: '小时' },
  },
  outsource_overdue_days: {
    label: '外协超期阈值',
    help: '外协单超过预计回厂日多少天算超期。影响老板看板的「超期外协」和每日超期推送。',
    field: { kind: 'int', name: 'days', min: 1, max: 30, unit: '天' },
  },
  report_qty_max_multiple: {
    label: '单条报工数量上限倍数',
    help: '师傅单条报工时，合格 + 不良 + 返工 的合计达到计划数的多少倍就一律拒绝。少报一律放行；超过计划数但未达上限需勾选确认并留痕。批量「一键完工」按计划数报，不受此项影响。',
    field: { kind: 'int', name: 'multiple', min: 1, max: 10, unit: '倍' },
  },
} as const satisfies Record<string, SettingMetadata>;

export type SettingKey = keyof typeof SETTING_METADATA;

export const SETTING_KEYS = Object.keys(SETTING_METADATA) as SettingKey[];

export function isSettingKey(value: string): value is SettingKey {
  return Object.hasOwn(SETTING_METADATA, value);
}
