import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const seedSource = readFileSync(
  join(process.cwd(), 'prisma', 'seed.ts'),
  'utf8',
);

function section(startMarker: string, endMarker: string) {
  const start = seedSource.indexOf(startMarker);
  const end = seedSource.indexOf(endMarker, start);

  if (start < 0 || end < 0) {
    throw new Error(`seed.ts 缺少分段标记: ${startMarker} -> ${endMarker}`);
  }

  return seedSource.slice(start, end);
}

const craftSeed = section(
  'async function seedCrafts()',
  '// 3. 薪资规则',
);
const salarySeed = section(
  'async function seedSalaryRules()',
  '// 4. 推送事件预置',
);

describe('seed.ts 规则中心数据保护', () => {
  it('工艺默认项只补缺失记录，不回写后台编辑字段', () => {
    expect(craftSeed).toContain('db.craft.createMany');
    expect(craftSeed).toContain('skipDuplicates: true');
    expect(craftSeed).not.toMatch(/db\.craft\.(?:upsert|update|updateMany)\s*\(/);
  });

  it('STOCK_FOIL 在首次初始化时保持停用', () => {
    const stockFoil = craftSeed.match(
      /\{[^{}]*code:\s*'STOCK_FOIL'[^{}]*\}/,
    )?.[0];

    expect(stockFoil, '找不到 STOCK_FOIL 工艺默认项').toBeDefined();
    expect(stockFoil).toContain('isActive: false');
  });

  it('薪资默认规则覆盖首次部署所需的完整键集', () => {
    const keys = Array.from(
      salarySeed.matchAll(/ruleKey:\s*'([^']+)'/g),
      (match) => match[1],
    );

    expect(keys).toEqual(['WORK_HOURS']);
  });

  it('薪资默认规则按完整历史补缺，不只查当前 open 版本', () => {
    expect(salarySeed).toContain('tx.salaryRule.findMany');
    expect(salarySeed).toContain('OR: rules.map');
    expect(salarySeed).toContain('select: { ruleType: true, ruleKey: true }');
    expect(salarySeed).toContain('const missing = rules.filter');
    expect(salarySeed).not.toContain('effectiveTo');
  });

  it('薪资 seed 只创建缺失键，不修改或收尾已有版本', () => {
    expect(salarySeed).toContain('db.$transaction');
    expect(salarySeed).toContain(
      'print-shop-erp:salary-rules:snapshot',
    );
    expect(salarySeed).toContain('tx.salaryRule.createMany');
    expect(salarySeed).toContain('data: missing.map');
    expect(salarySeed).toContain('skipDuplicates: true');
    expect(salarySeed).not.toMatch(
      /salaryRule\.(?:upsert|update|updateMany)\s*\(/,
    );
  });
});
