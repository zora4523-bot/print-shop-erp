import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../OrderCommercialDetailsManager.tsx', import.meta.url),
  'utf8',
);

describe('OrderCommercialDetailsManager contract', () => {
  it('exposes the three structured order-level charge types', () => {
    expect(source).toContain("value: 'SAMPLE_FEE'");
    expect(source).toContain("value: 'OTHER_PACKAGING_FEE'");
    expect(source).toContain("value: 'APPROVED_ADJUSTMENT'");
    expect(source).toContain('审批信息（审批人 / 单号 / 结论）');
  });

  it('supports append/update and auditable soft removal for plate rows', () => {
    expect(source).toContain('添加制版明细');
    expect(source).toContain('保存制版修改');
    expect(source).toContain('移除并保留历史');
    expect(source).toContain('制版明细保留为已移除历史记录');
  });
});
