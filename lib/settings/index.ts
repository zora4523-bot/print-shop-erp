import { db } from '../db';
import { writeAuditLogInTx, type AuditActor } from '../audit-log';
import {
  SETTING_DEFINITIONS,
  SETTING_KEYS,
  resolveSetting,
  type SettingKey,
  type SettingValue,
} from './definitions';
import { acquireWorkerSelfClaimSettingWriteLock } from './locks';

export {
  SETTING_DEFINITIONS,
  SETTING_KEYS,
  RETIRED_SETTING_KEYS,
  formatSettingForInput,
  isSettingKey,
  parseSettingInput,
  resolveSetting,
} from './definitions';
export type {
  SettingKey,
  SettingValue,
  SettingInputResult,
} from './definitions';

// 不做请求级缓存（React cache()）是刻意的：读取方里有 lib/cron/tasks.ts 和
// background job，跑在 PM2 worker 里，根本没有 request 上下文。一次按唯一键
// 查单行的开销远小于「同一份代码在两种运行时里行为不一样」的维护成本。
// 读取方按需做一次单键查询；设置页则通过 getAllSettings 一次批量读取。

export async function getSetting<K extends SettingKey>(
  key: K,
): Promise<SettingValue<K>> {
  const row = await db.setting.findUnique({
    where: { key },
    select: { value: true },
  });
  return resolveSetting(key, row?.value);
}

export type AllSettings = { [K in SettingKey]: SettingValue<K> };

/** 后台设置页用：一次查完，避免 N 次单键查询。 */
export async function getAllSettings(): Promise<AllSettings> {
  const rows = await db.setting.findMany({
    where: { key: { in: SETTING_KEYS } },
    select: { key: true, value: true },
  });
  const byKey = new Map(rows.map((r) => [r.key, r.value]));

  // 从 SETTING_KEYS 出发而不是从查询结果出发：没有对应行的 key 也要拿到兜底
  // 值，否则新加的配置项在没跑过 seed 的库上会是 undefined。
  // 循环里 key 是联合类型，TS 会把 result[key] 的目标类型收敛成各项 value
  // 类型的交集（永远赋不进去）。resolveSetting 本身是逐 key 类型安全的，
  // 这里的断言只是解开映射类型在写入侧的这个已知限制。
  const result: Record<string, unknown> = {};
  for (const key of SETTING_KEYS) {
    result[key] = resolveSetting(key, byKey.get(key));
  }
  return result as AllSettings;
}

export class SettingValidationError extends Error {
  readonly key: SettingKey;

  constructor(key: SettingKey, message: string) {
    super(message);
    this.name = 'SettingValidationError';
    this.key = key;
  }
}

/**
 * 批量写入。调用方（actions/owner-settings.ts）已经把表单字符串解析成值了，
 * 这里再过一遍 schema —— 读取侧校验不过会静默退回默认值，所以写入侧必须是
 * 严格的那一端，不然业主存了个非法值、页面显示旧值，还找不到原因。
 *
 * 逐项写审计（entityType='Setting'，entityId=配置 key），和薪资规则一样放在
 * 同一个事务里：配置改动和它的证据不能各自提交。「谁把 CDR 链接有效期从
 * 24 小时改成 1 小时」必须答得上来。
 */
export async function updateSettings(
  input: Partial<AllSettings>,
  actor: AuditActor | null = null,
): Promise<void> {
  const entries = Object.entries(input) as Array<
    [SettingKey, SettingValue<SettingKey>]
  >;
  if (entries.length === 0) return;

  for (const [key, value] of entries) {
    const parsed = SETTING_DEFINITIONS[key].schema.safeParse(value);
    if (!parsed.success) {
      throw new SettingValidationError(
        key,
        parsed.error.issues[0]?.message ?? `${SETTING_DEFINITIONS[key].label}不合法`,
      );
    }
  }

  // 一个事务：几项配置要么一起生效要么都不动，避免业主看到「厂名改了、阈值没改」
  // 这种半截状态。用 callback 形式（不是数组形式）才能把审计写在同一个 tx 里。
  await db.$transaction(async (tx) => {
    // 表单整体提交；只要包含抢单开关就先拿排他锁。即使本次值
    // 未变，短暂串行也比“关闭已返回但又成功抢入一单”更容易解释。
    if (entries.some(([key]) => key === 'worker_self_claim_enabled')) {
      await acquireWorkerSelfClaimSettingWriteLock(tx);
    }
    const existing = await tx.setting.findMany({
      where: { key: { in: entries.map(([key]) => key) } },
      select: { key: true, value: true },
    });
    const byKey = new Map(existing.map((row) => [row.key, row.value]));

    for (const [key, value] of entries) {
      const before = resolveSetting(key, byKey.get(key));
      // 表单是整体提交的，业主只改一项时另外几项会原样回传。没变的不写
      // 审计，否则日志里全是噪音，真正的改动反而找不到。
      if (JSON.stringify(before) === JSON.stringify(value)) continue;

      await tx.setting.upsert({
        where: { key },
        update: { value, remark: SETTING_DEFINITIONS[key].remark },
        create: { key, value, remark: SETTING_DEFINITIONS[key].remark },
      });

      await writeAuditLogInTx(tx, {
        actor,
        action: 'UPDATE',
        entityType: 'Setting',
        entityId: key,
        before,
        after: value,
        requestMetadata: {
          source: 'lib/settings.updateSettings',
          route: '/owner/settings',
        },
      });
    }
  });
}
