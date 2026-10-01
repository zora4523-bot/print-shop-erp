/**
 * 设置页客户端所需的纯元数据。
 *
 * 这个模块会被 `SettingsForm` 的 `use client` 边界引用，因此不得引入
 * Zod、数据库或任何服务端依赖。服务端 schema / fallback / remark 在
 * `./definitions.ts` 中补齐，并直接展开这里的元数据，避免表单约束漂移。
 */

export type SettingFieldSpec =
  | { kind: 'text'; name: string; maxLength: number }
  | { kind: 'int'; name: string; min: number; max: number; unit: string }
  | { kind: 'boolean'; name: string }
  | {
      kind: 'management-notification-routing';
      // Keep a real property name here so the generic definition contract can
      // still prove that the field metadata and persisted shape agree.
      name: 'factoryConfirmer';
    };

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
    help: '1–168 小时。',
    field: { kind: 'int', name: 'hours', min: 1, max: 168, unit: '小时' },
  },
  outsource_overdue_days: {
    label: '外协超期阈值',
    help: '超过预计回厂日的天数，1–30 天。',
    field: { kind: 'int', name: 'days', min: 1, max: 30, unit: '天' },
  },
  report_qty_max_multiple: {
    label: '单条报工数量上限倍数',
    help: '单条报工总数达到计划数量 × 此倍数时拒绝；低于上限的超报需确认并留痕。',
    field: { kind: 'int', name: 'multiple', min: 1, max: 10, unit: '倍' },
  },
  production_stagnation_days: {
    label: '生产停滞阈值',
    help: '工单下发后超过多少天仍无人首次扫码认领时标记停滞并触发通知。',
    field: { kind: 'int', name: 'days', min: 1, max: 30, unit: '天' },
  },
  production_alert_scan_batch_size: {
    label: '生产提醒扫描批量',
    help: '每批最多检查的工单数，1–500 单。',
    field: { kind: 'int', name: 'count', min: 1, max: 500, unit: '单' },
  },
  pending_factory_backlog_threshold: {
    label: '待确认积压阈值',
    help: '待工厂确认的工单达到该数量时触发积压提醒。',
    field: { kind: 'int', name: 'count', min: 1, max: 500, unit: '单' },
  },
  management_notification_routing: {
    label: '管理通知接收群',
    help: '',
    field: {
      kind: 'management-notification-routing',
      name: 'factoryConfirmer',
    },
  },
  notify_order_submitted_enabled: {
    label: '新单提交通知',
    help: '',
    field: { kind: 'boolean', name: 'enabled' },
  },
  notify_order_change_enabled: {
    label: '变更与取消申请通知',
    help: '',
    field: { kind: 'boolean', name: 'enabled' },
  },
  notify_production_anomaly_enabled: {
    label: '报工异常通知',
    help: '',
    field: { kind: 'boolean', name: 'enabled' },
  },
  notify_production_stagnation_enabled: {
    label: '生产停滞通知',
    help: '',
    field: { kind: 'boolean', name: 'enabled' },
  },
  notify_pending_factory_backlog_enabled: {
    label: '待确认积压通知',
    help: '',
    field: { kind: 'boolean', name: 'enabled' },
  },
} as const satisfies Record<string, SettingMetadata>;

export type SettingKey = keyof typeof SETTING_METADATA;

export const SETTING_KEYS = Object.keys(SETTING_METADATA) as SettingKey[];

export function isSettingKey(value: string): value is SettingKey {
  return Object.hasOwn(SETTING_METADATA, value);
}
