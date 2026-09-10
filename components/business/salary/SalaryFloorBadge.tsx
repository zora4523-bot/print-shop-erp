import Decimal from 'decimal.js';
import { StatusBadge } from '@/components/ui-business';
import { salaryFloorStatusDefinition } from '@/lib/ui/status-registry';

// 计件保底徽章——师傅端工资列表 / 工资明细与管理端历史日薪三处共用。
// 归并前三处各自写 shadcn Badge 的 secondary/outline，label 逐字重复三遍。
//
// props 取 Decimal.Value（string | number | Decimal）而不是 Decimal 实例：
// 三个调用点的字段都来自 Prisma 的 Decimal 列，现有写法已是 `x as Decimal.Value`，
// 这样调用点不必再 new 一次。金额比较留在本组件——lib/ui/status-registry.ts
// 保持零运行时依赖，派生函数只收 Decimal#cmp 的返回值。
export function SalaryFloorBadge({
  piecework,
  base,
}: {
  piecework: Decimal.Value;
  base: Decimal.Value;
}) {
  const definition = salaryFloorStatusDefinition(
    new Decimal(piecework).cmp(new Decimal(base)),
  );
  return (
    <StatusBadge tone={definition.tone} dot={definition.dot}>
      {definition.label}
    </StatusBadge>
  );
}
