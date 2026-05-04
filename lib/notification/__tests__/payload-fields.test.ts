import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NOTIFICATION_EVENTS } from '../events';
import { NOTIFICATION_PAYLOAD_FIELDS } from '../payload-fields';

// 防回归闸：seed.ts 默认模板里 placeholder 必须 ⊆ 该事件的 payload 字段。
// Codex round 101/102 分别为 ORDER_SUBMITTED / ORDER_SHIPPED 暴露了
// "模板用了 payload 没的字段 → 渲染时 raw {x} 流到群消息"。这条 spec
// 让未来人改 seed 加新占位符 / 改 payload 漏字段时立刻 fail，避免再
// 来一轮 Codex review。
//
// 实现：读 prisma/seed.ts 文本，正则提取 seedNotificationEvents 函数
// 内的 messageTemplate / eventType 对，对每个事件抽 placeholder 与
// NOTIFICATION_PAYLOAD_FIELDS 对照。

type SeedTemplate = { eventType: string; placeholders: string[] };

function extractSeedTemplates(): SeedTemplate[] {
  const seedPath = join(
    process.cwd(),
    'prisma',
    'seed.ts',
  );
  const src = readFileSync(seedPath, 'utf8');
  // 截取 seedNotificationEvents 函数体
  const start = src.indexOf('async function seedNotificationEvents');
  if (start < 0) throw new Error('seedNotificationEvents 函数找不到');
  const end = src.indexOf('\n}\n', start);
  const body = src.slice(start, end);

  // 在函数体内匹配 `eventType: 'X'` + 紧跟的 `messageTemplate: '...'`
  // （单行；多行模板会用 backtick / 反斜杠续行——seed.ts 当前都是单
  // 行的 + \n 转义，正则够用）
  const ruleRe =
    /eventType:\s*'([A-Z_]+)'\s*,\s*messageTemplate:\s*'((?:[^'\\]|\\.)*)'/g;
  const out: SeedTemplate[] = [];
  let m: RegExpExecArray | null;
  while ((m = ruleRe.exec(body))) {
    const eventType = m[1]!;
    const tmpl = m[2]!;
    const phRe = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g;
    const placeholders: string[] = [];
    let pm: RegExpExecArray | null;
    while ((pm = phRe.exec(tmpl))) placeholders.push(pm[1]!);
    out.push({ eventType, placeholders });
  }
  return out;
}

describe('seed.ts notification templates ⊆ NOTIFICATION_PAYLOAD_FIELDS', () => {
  const seeds = extractSeedTemplates();

  it('能从 seed.ts 抽出 10 条 rule', () => {
    expect(seeds.length).toBe(10);
  });

  it('每条 rule 的 eventType 都是 NOTIFICATION_EVENTS 已定义的', () => {
    const known = new Set(Object.values(NOTIFICATION_EVENTS) as string[]);
    for (const s of seeds) {
      expect(known.has(s.eventType), `${s.eventType} 不在 NOTIFICATION_EVENTS`).toBe(
        true,
      );
    }
  });

  it('每条 rule 的 placeholder 都在该事件的 PAYLOAD_FIELDS 里', () => {
    for (const s of seeds) {
      const allowed: Set<string> = new Set(
        NOTIFICATION_PAYLOAD_FIELDS[
          s.eventType as keyof typeof NOTIFICATION_PAYLOAD_FIELDS
        ] ?? [],
      );
      for (const ph of s.placeholders) {
        expect(
          allowed.has(ph),
          `事件 ${s.eventType} 模板使用 {${ph}}，但 NOTIFICATION_PAYLOAD_FIELDS[${s.eventType}] 不含该字段。\n` +
            `→ 要么 seed.ts 模板拿掉这个 placeholder，要么 events.ts 给 ${s.eventType} payload 加 ${ph} 字段（同时改 payload-fields.ts）。`,
        ).toBe(true);
      }
    }
  });
});
