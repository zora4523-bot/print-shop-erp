import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import {
  calcMachinePiecework,
  calcMachinePieceworkBreakdown,
  calcMachineDailySalary,
  type MachineSalaryRule,
} from '../machine-piecework';

// Initial values from SPEC §5.2 parameter table.
const HAND_PRESS_RULE: MachineSalaryRule = {
  pieceRate: '0.007',
  boardRate: '5',
  smallOrderThreshold: 1000,
  smallOrderFlatPrice: '12',
  multiplierFactors: ['DOUBLE_SIDED', 'DOUBLE_COLOR'],
};

const WINDMILL_RULE: MachineSalaryRule = {
  pieceRate: '0.01',
  boardRate: '0',
  smallOrderThreshold: 1000,
  smallOrderFlatPrice: '20',
  smallOrderInclusive: true,
  largeOrderSetupFee: '10',
  multiplierFactors: ['DOUBLE_COLOR'],
};

// SPEC §5.2 marks thresholds as "—" for GLUE; we encode that as null.
const GLUE_RULE: MachineSalaryRule = {
  pieceRate: '0.002',
  boardRate: '0',
  smallOrderThreshold: null,
  smallOrderFlatPrice: '0',
  multiplierFactors: [],
};

function task(
  overrides: Partial<{
    quantity: number;
    itemCount: number;
    isDoubleSided: boolean;
    isDoubleColor: boolean;
  }> = {},
) {
  return {
    quantity: 1000,
    itemCount: 1,
    isDoubleSided: false,
    isDoubleColor: false,
    ...overrides,
  };
}

function eq(actual: Decimal, expected: string): void {
  // toFixed(4) gives enough precision to catch any sub-cent drift
  // while tolerating Decimal's internal representation.
  expect(actual.toFixed(4)).toBe(new Decimal(expected).toFixed(4));
}

describe('calcMachinePiecework — HAND_PRESS (开机仔)', () => {
  it('small order (quantity < 1000): returns the flat price, no board/press count', () => {
    const r = calcMachinePieceworkBreakdown(task({ quantity: 500 }), HAND_PRESS_RULE);
    expect(r.smallOrder).toBe(true);
    expect(r.boardCount).toBe(0);
    expect(r.pressCount).toBe(0);
    eq(r.amount, '12');
  });

  it('quantity exactly at threshold is NOT a small order (strict <)', () => {
    // 1000 quantity should NOT trigger the flat price (threshold is
    // strict <). This catches a common "off-by-one at the boundary"
    // footgun.
    const r = calcMachinePieceworkBreakdown(task({ quantity: 1000 }), HAND_PRESS_RULE);
    expect(r.smallOrder).toBe(false);
    // 1×5 + 1000×0.007 = 5 + 7 = 12 (happens to equal flat price but
    // via the formula path, not the small-order branch).
    eq(r.amount, '12');
  });

  it('single side single color: 1×5 + 5000×0.007 = 40', () => {
    const r = calcMachinePieceworkBreakdown(task({ quantity: 5000 }), HAND_PRESS_RULE);
    expect(r.multiplier).toBe(1);
    eq(r.amount, '40');
  });

  it('double side only: 2×5 + 10000×0.007 = 80', () => {
    const r = calcMachinePieceworkBreakdown(
      task({ quantity: 5000, isDoubleSided: true }),
      HAND_PRESS_RULE,
    );
    expect(r.multiplier).toBe(2);
    expect(r.boardCount).toBe(2);
    expect(r.pressCount).toBe(10000);
    eq(r.amount, '80');
  });

  it('double side + double color composes (×4): 4×5 + 20000×0.007 = 160', () => {
    const r = calcMachinePieceworkBreakdown(
      task({
        quantity: 5000,
        isDoubleSided: true,
        isDoubleColor: true,
      }),
      HAND_PRESS_RULE,
    );
    expect(r.multiplier).toBe(4);
    eq(r.amount, '160');
  });

  it('SPEC §7.1 row-by-row reproduction (张三某日)', () => {
    // T1 小单 500 → 12
    eq(calcMachinePiecework(task({ quantity: 500 }), HAND_PRESS_RULE), '12');
    // T2 5+56=61 → 1×5 + 8000×0.007 = 5 + 56 = 61
    eq(calcMachinePiecework(task({ quantity: 8000 }), HAND_PRESS_RULE), '61');
    // T3 10+42=52 → 2×5 + 6000×0.007 = 10 + 42 = 52
    eq(
      calcMachinePiecework(
        task({ quantity: 3000, isDoubleSided: true }),
        HAND_PRESS_RULE,
      ),
      '52',
    );
    // T4 20+56=76 → 4×5 + 8000×0.007 = 20 + 56 = 76
    eq(
      calcMachinePiecework(
        task({ quantity: 2000, isDoubleSided: true, isDoubleColor: true }),
        HAND_PRESS_RULE,
      ),
      '76',
    );
  });
});

describe('calcMachinePiecework — WINDMILL (风车机)', () => {
  it('ignores double-sided even when the flag is set', () => {
    const r = calcMachinePieceworkBreakdown(
      task({ quantity: 5000, isDoubleSided: true }),
      WINDMILL_RULE,
    );
    expect(r.multiplier).toBe(1);
    // 5000 × 0.01 + 10 元装板费 = 60
    eq(r.amount, '60');
  });

  it('applies double-color (only factor in its multiplierFactors list)', () => {
    const r = calcMachinePieceworkBreakdown(
      task({ quantity: 5000, isDoubleSided: true, isDoubleColor: true }),
      WINDMILL_RULE,
    );
    // multiplier: ignore DOUBLE_SIDED, ×2 for DOUBLE_COLOR
    expect(r.multiplier).toBe(2);
    // 10000 × 0.01 + 10 元装板费 = 110。装板费不跟双色翻倍。
    eq(r.amount, '110');
  });

  it('1000 个及以下均走 20 元固定上板费', () => {
    eq(calcMachinePiecework(task({ quantity: 500 }), WINDMILL_RULE), '20');
    const boundary = calcMachinePieceworkBreakdown(
      task({ quantity: 1000 }),
      WINDMILL_RULE,
    );
    expect(boundary.smallOrder).toBe(true);
    eq(boundary.amount, '20');
  });

  it('1001 个切换到每个 0.01 元 + 装板 10 元', () => {
    const r = calcMachinePieceworkBreakdown(
      task({ quantity: 1001 }),
      WINDMILL_RULE,
    );
    expect(r.smallOrder).toBe(false);
    eq(r.amount, '20.01');
  });

  it('按现行风车机规则汇总一天的任务', () => {
    eq(calcMachinePiecework(task({ quantity: 500 }), WINDMILL_RULE), '20');
    eq(calcMachinePiecework(task({ quantity: 5000 }), WINDMILL_RULE), '60');
    eq(
      calcMachinePiecework(
        task({ quantity: 8000, isDoubleColor: true }),
        WINDMILL_RULE,
      ),
      '170',
    );
  });
});

describe('calcMachinePiecework — GLUE (黏封机)', () => {
  it('has no small-order protection (threshold null)', () => {
    // A 100-piece glue task should still be paid pro-rata, not flat.
    const r = calcMachinePieceworkBreakdown(task({ quantity: 100 }), GLUE_RULE);
    expect(r.smallOrder).toBe(false);
    eq(r.amount, '0.20'); // 100 × 0.002
  });

  it('no multipliers apply even when flags are set (empty factor list)', () => {
    const r = calcMachinePieceworkBreakdown(
      task({ quantity: 10000, isDoubleSided: true, isDoubleColor: true }),
      GLUE_RULE,
    );
    expect(r.multiplier).toBe(1);
    eq(r.amount, '20'); // 10000 × 0.002
  });
});

describe('calcMachinePiecework — precision', () => {
  it('no JS float rounding on 0.1 + 0.2 style edges', () => {
    // 0.1 × 3 in JS is 0.30000000000000004. Decimal should give us 0.30.
    const rule: MachineSalaryRule = {
      pieceRate: '0.1',
      boardRate: '0',
      smallOrderThreshold: null,
      smallOrderFlatPrice: '0',
      multiplierFactors: [],
    };
    const r = calcMachinePiecework(task({ quantity: 3 }), rule);
    expect(r.toFixed(2)).toBe('0.30');
  });

  it('accepts numeric rule fields as well as strings', () => {
    const rule: MachineSalaryRule = {
      pieceRate: 0.007,
      boardRate: 5,
      smallOrderThreshold: 1000,
      smallOrderFlatPrice: 12,
      multiplierFactors: ['DOUBLE_SIDED', 'DOUBLE_COLOR'],
    };
    eq(calcMachinePiecework(task({ quantity: 5000 }), rule), '40');
  });
});

describe('calcMachineDailySalary', () => {
  it('returns max(sum of tasks, daily base)', () => {
    // 开机仔: SPEC §7.1 张三 — 12+61+52+76=201, base=100 → 201
    eq(
      calcMachineDailySalary(['12', '61', '52', '76'], '100'),
      '201',
    );
    // 风车现行规则：20+60+170=250，超过 120 元底薪
    eq(calcMachineDailySalary(['20', '60', '170'], '120'), '250');
  });

  it('floors to the daily base when piecework total is below it', () => {
    // Rainy day: only 40 in tasks; base=100 → pay 100.
    eq(calcMachineDailySalary(['40'], '100'), '100');
  });

  it('empty task list returns the base (师傅当日无任务)', () => {
    eq(calcMachineDailySalary([], '100'), '100');
  });

  it('accepts Decimal inputs directly', () => {
    eq(
      calcMachineDailySalary([new Decimal('61.00'), new Decimal('139')], 100),
      '200',
    );
  });
});
