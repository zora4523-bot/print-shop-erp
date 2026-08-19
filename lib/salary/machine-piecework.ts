import Decimal from 'decimal.js';

// Pure math for the 开机师傅 piecework amount on a single
// ProductionTask (SPEC §5.2 / §7.1 / §7.2).
//
// This file intentionally has NO database access — it takes a plain
// task shape + a decoded SalaryRule payload and returns a Decimal.
// The caller in lib/production.ts is responsible for:
//   1. Resolving the active SalaryRule.ruleValue for the worker's
//      current machineType.
//   2. Snapshotting that value onto ProductionTask.salaryRuleSnapshot
//      at report time (CLAUDE.md §4.4 rule-snapshot bedrock).
//
// Keeping the math pure means the test suite doesn't need Prisma, and
// P0 #5 can reuse the same function to recompute daily totals.

// Factors that can be toggled in a machine rule. Each listed factor
// independently doubles both boardCount and pressCount when the task's
// matching flag is set — i.e. multipliers compose multiplicatively
// (double-sided + double-color = ×4, not ×3).
export type MachineMultiplierFactor = 'DOUBLE_SIDED' | 'DOUBLE_COLOR';

export type MachineSalaryRule = {
  // 单片下压单价（元/片）
  pieceRate: string | number;
  // 板数单价（元/板）— 风车 / 黏封通常为 0
  boardRate: string | number;
  // 小单保护阈值：默认 quantity 严格小于此值时走 flat price；
  // smallOrderInclusive=true 时阈值本身也纳入小单。
  // null 表示该机型无小单保护（例如黏封机）。
  smallOrderThreshold: number | null;
  // 小单 flat price — 只有在触发小单保护时才使用。
  // May be null when smallOrderThreshold is null (no small-order mode).
  smallOrderFlatPrice: string | number | null;
  // true means the threshold itself is included (e.g. 风车机 <= 1000).
  // Missing/false preserves historical rules that used strict "<".
  smallOrderInclusive?: boolean;
  // One-time setup fee per item when the task is above the small-order
  // threshold. It is deliberately not multiplied by double-color/side.
  largeOrderSetupFee?: string | number;
  multiplierFactors: readonly MachineMultiplierFactor[];
};

export type PieceworkTaskInput = {
  // OrderItem.quantity — 该任务覆盖的总片数。
  quantity: number;
  // 该任务覆盖的款式数（对 P0 每个 ProductionTask 对应单款式，恒为 1；
  // 结构上留下 hook 给未来的批量合并任务）。
  itemCount: number;
  isDoubleSided: boolean;
  isDoubleColor: boolean;
};

export type PieceworkBreakdown = {
  // 触发小单保护时固定收 flatPrice，boardCount / pressCount 不计。
  smallOrder: boolean;
  // 应用到 board / press 两个计数的倍率乘积。
  multiplier: number;
  boardCount: number;
  pressCount: number;
  // 最终计件金额（Decimal(10,2) 对齐；返回时 toFixed(2) 前先保留全精度）
  amount: Decimal;
};

// Compute every intermediate value the SPEC example tables expect, then
// let callers pick just the final amount via `calcMachinePiecework`.
// Kept separate so ProductionTask can persist boardCount / pressCount
// independently of the amount (schema has fields for both).
export function calcMachinePieceworkBreakdown(
  task: PieceworkTaskInput,
  rule: MachineSalaryRule,
): PieceworkBreakdown {
  const pieceRate = new Decimal(rule.pieceRate);
  const boardRate = new Decimal(rule.boardRate);

  // Small-order protection pays the flat price and skips board/press
  // counts. The boundary is strict by default; rules may opt into an
  // inclusive threshold. `null` opts out entirely (e.g. glue machine).
  if (
    rule.smallOrderThreshold !== null &&
    (task.quantity < rule.smallOrderThreshold ||
      (rule.smallOrderInclusive === true &&
        task.quantity === rule.smallOrderThreshold))
  ) {
    // 类型上 threshold 与 flatPrice 是两个独立的可空字段，但业务不变量是
    // 「有阈值就必须有 flat price」（见上面 smallOrderFlatPrice 的注释）。
    // 之前这里是 `?? 0`——配置漏了 flat price 时小单静默按 0 结算，正是
    // CLAUDE.md §15.5 列为头号事故的那种失败。拒绝继续，不猜。
    if (rule.smallOrderFlatPrice === null || rule.smallOrderFlatPrice === undefined) {
      throw new Error(
        '小单保护规则不完整：设置了小单阈值但没有小单一口价，拒绝按 0 结算',
      );
    }
    return {
      smallOrder: true,
      multiplier: 1,
      boardCount: 0,
      pressCount: 0,
      amount: new Decimal(rule.smallOrderFlatPrice),
    };
  }

  // Multipliers apply independently — double-sided AND double-color is
  // ×4, not ×3. Factors the machine rule doesn't list are ignored even
  // if the task has the flag set (风车机 不看双面).
  let multiplier = 1;
  if (rule.multiplierFactors.includes('DOUBLE_SIDED') && task.isDoubleSided) {
    multiplier *= 2;
  }
  if (rule.multiplierFactors.includes('DOUBLE_COLOR') && task.isDoubleColor) {
    multiplier *= 2;
  }

  const boardCount = task.itemCount * multiplier;
  const pressCount = task.quantity * multiplier;
  const amount = boardRate
    .times(boardCount)
    .plus(pieceRate.times(pressCount))
    .plus(
      new Decimal(rule.largeOrderSetupFee ?? 0).times(task.itemCount),
    );
  return {
    smallOrder: false,
    multiplier,
    boardCount,
    pressCount,
    amount,
  };
}

export function calcMachinePiecework(
  task: PieceworkTaskInput,
  rule: MachineSalaryRule,
): Decimal {
  return calcMachinePieceworkBreakdown(task, rule).amount;
}

// Daily salary = max(sum of all piecework, daily base). SPEC §5.2 /
// §7.1 examples feed directly into this. Kept here because it's the
// same domain (开机师傅日薪) and still pure.
export function calcMachineDailySalary(
  taskAmounts: readonly (string | number | Decimal)[],
  dailyBase: string | number | Decimal,
): Decimal {
  const total = taskAmounts.reduce<Decimal>(
    (acc, a) => acc.plus(new Decimal(a as Decimal.Value)),
    new Decimal(0),
  );
  const base = new Decimal(dailyBase as Decimal.Value);
  return Decimal.max(total, base);
}
