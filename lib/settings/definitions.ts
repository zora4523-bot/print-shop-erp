import { z } from 'zod';
import {
  SETTING_METADATA,
  type SettingKey,
  type SettingMetadata,
} from './metadata';

export { SETTING_KEYS, SETTING_METADATA, isSettingKey } from './metadata';
export type {
  SettingFieldSpec,
  SettingKey,
  SettingMetadata,
} from './metadata';

// 系统配置的服务端定义：在 ./metadata.ts 的客户端安全元数据上，
// 补齐 schema、fallback 和写入数据库的 remark。SettingsForm 不能引用本文件：
// `use client` 会把 Zod 整个带进浏览器依赖图。读写实现仍在 ./index.ts。
//
// 背景：Setting 表从建表起就只有 prisma/seed.ts 一个写入方、零个读取方，四个 key
// 全部在别处有硬编码副本。最直观的后果是打印视图的厂名永远是默认值——业主改了
// 设置没有任何效果。这个模块存在的意义就是把这条链路接通。

type SettingDefinition<T> = SettingMetadata & {
  // 写回 Setting.remark，让直接翻库的人也知道这一行是干什么的
  remark: string;
  schema: z.ZodType<T>;
  fallback: T;
};

function define<T>(definition: SettingDefinition<T>): SettingDefinition<T> {
  return definition;
}

export const SETTING_DEFINITIONS = {
  factory_name: define({
    ...SETTING_METADATA.factory_name,
    remark: '工厂名称（可改）',
    schema: z.object({
      name: z
        .string()
        .trim()
        .min(1, '工厂名称不能为空')
        .max(40, '工厂名称最多 40 个字'),
    }),
    fallback: { name: '佛山红包印刷厂' },
  }),

  cdr_link_expire_hours: define({
    ...SETTING_METADATA.cdr_link_expire_hours,
    remark: 'CDR下载链接有效期',
    schema: z.object({
      // 上限 168 小时 = 7 天，是 OSS 用 AccessKey 直签 URL 的实际可用上限；
      // 再长签出来的链接到期时间是假的，用户点开只会拿到 403。
      hours: z
        .number()
        .int('有效期必须是整数小时')
        .min(1, '有效期至少 1 小时')
        .max(168, '有效期最多 168 小时（7 天）'),
    }),
    fallback: { hours: 24 },
  }),

  outsource_overdue_days: define({
    ...SETTING_METADATA.outsource_overdue_days,
    remark: '外协超期阈值（超过预计日N天报警）',
    schema: z.object({
      days: z
        .number()
        .int('阈值必须是整数天')
        .min(1, '阈值至少 1 天')
        .max(30, '阈值最多 30 天'),
    }),
    fallback: { days: 1 },
  }),

  report_qty_max_multiple: define({
    ...SETTING_METADATA.report_qty_max_multiple,
    remark: '单条报工数量上限倍数（合计 >= 计划数×N 一律拒绝）',
    schema: z.object({
      // 判据是 >= 而不是 >：「多打一个零」把 P 变成 10P，严格大于时 N=10
      // 恰好放行——那正是这道守卫唯一要挡的场景。上限收到 10 是同一个理由：
      // 允许配到 100 等于把守卫关掉。下限 1 是严格模式（limit = 计划数，
      // 任何超报都硬拒，确认分支自然失效）。
      multiple: z
        .number()
        .int('倍数必须是整数')
        .min(1, '倍数至少 1 倍')
        .max(10, '倍数最多 10 倍'),
    }),
    fallback: { multiple: 3 },
  }),
};

export type SettingValue<K extends SettingKey> =
  (typeof SETTING_DEFINITIONS)[K] extends SettingDefinition<infer T> ? T : never;

// seed 曾经写过、现在不再对应任何行为的 key。留着比删掉更坏：它让翻库的人以为
// 工单号格式可配，而实际上 SEQ_PAD / MAX_DAILY_SEQUENCE 是代码常量，
// 而且 PO/PR/ST/IC 四个兄弟单号前缀也都写死在 lib/daily-document-number.ts。
// seed 会顺手把这些行删掉，见 prisma/seed.ts。
export const RETIRED_SETTING_KEYS = ['order_no_prefix'] as const;

/**
 * 把库里存的 JSON 解成类型化的值。校验不过时**退回内置默认值**而不是抛错。
 *
 * 这里和 §15.5「没有生效规则就拒绝继续」的取向相反，是有意的：那条铁律管的是
 * 薪资和报价，静默按 0 结算会直接算错钱。而厂名印错、超期阈值回到 1 天、链接
 * 有效期回到 24 小时，都是能一眼看出来且随时可改的。反过来，让一行手工改坏的
 * 配置把开单、打印、每日推送全部打挂，才是真正的事故。
 *
 * report_qty_max_multiple 是四项里唯一守着「会算出计件金额」那条路径的，但退回
 * fallback 同样安全，而且方向是对的：它本身不参与任何金额计算，只是一个上界；
 * 库里存了个非法的大值（比如被手工改成 999）时退回 3 反而更严，存了个非法的
 * 小值时退回 3 也仍然把「多打一个零」挡在门外。它绝不会像薪资规则缺失那样
 * 让金额静默变成 0。
 *
 * 正常路径上校验不过是进不来的：写入侧走同一份 schema（见 ./index.ts 的
 * updateSettings），只有直接改库才可能塞进非法值。
 */
export function resolveSetting<K extends SettingKey>(
  key: K,
  raw: unknown,
): SettingValue<K> {
  const definition = SETTING_DEFINITIONS[key];
  const parsed = definition.schema.safeParse(raw);
  return (parsed.success ? parsed.data : definition.fallback) as SettingValue<K>;
}

export type SettingInputResult<K extends SettingKey> =
  | { ok: true; value: SettingValue<K> }
  | { ok: false; message: string };

/**
 * 后台表单的一个输入框 → 可以落库的值。文本框拿到的永远是 string，整数项要先
 * 转成 number 再过 schema，否则 z.number() 必然失败。
 */
export function parseSettingInput<K extends SettingKey>(
  key: K,
  raw: string,
): SettingInputResult<K> {
  const definition = SETTING_DEFINITIONS[key];
  const { field } = definition;
  const trimmed = raw.trim();

  let candidate: unknown;
  if (field.kind === 'int') {
    // 先自己挡一道：Number('') === 0、Number('12天') === NaN，直接交给 zod
    // 会分别变成「悄悄存成 0」和一句看不懂的 NaN 报错。
    if (trimmed === '') {
      return { ok: false, message: `${definition.label}不能为空` };
    }
    if (!/^\d+$/.test(trimmed)) {
      return { ok: false, message: `${definition.label}必须是正整数` };
    }
    candidate = { [field.name]: Number.parseInt(trimmed, 10) };
  } else {
    candidate = { [field.name]: trimmed };
  }

  const parsed = definition.schema.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? `${definition.label}不合法`,
    };
  }
  return { ok: true, value: parsed.data as SettingValue<K> };
}

/** 已生效的值 → 表单输入框的 defaultValue。 */
export function formatSettingForInput<K extends SettingKey>(
  key: K,
  value: SettingValue<K>,
): string {
  const { field } = SETTING_DEFINITIONS[key];
  return String((value as Record<string, unknown>)[field.name] ?? '');
}
