import { describe, it, expect, vi } from 'vitest';
import {
  EmploymentType,
  MachineType,
  OrderCostCategory,
  PartyType,
  Role,
  WorkerType,
} from '../../../generated/prisma/enums';
import {
  loginSchema,
  changePasswordSchema,
  createUserSchema,
  updateUserSchema,
  resetUserPasswordSchema,
  createCraftSchema,
  updateCraftSchema,
  createProductSchema,
  createProductCategoryNodeSchema,
  createPartySchema,
  updatePartySchema,
  createMaterialSchema,
  updateMaterialSchema,
  createWarehouseSchema,
  createWarehouseLocationSchema,
  createStockTransferSchema,
  postInventoryCountSchema,
  materialStockTransactionSchema,
  createPurchaseOrderSchema,
  createPurchaseReceiptSchema,
  cancelPurchaseReceiptSchema,
  updateProductSchema,
  createOrderSchema,
  shipOrderSchema,
  createReworkOrderSchema,
  createOutsourceSchema,
  confirmOutsourceAmountSchema,
  recordOutsourcePaymentSchema,
  updateEditableOrderSchema,
  setOrderSfCollectSchema,
  startCsPeriodSchema,
  recordCsPayrollPaymentSchema,
  recordBillPaymentSchema,
  createOrderCostEntrySchema,
  createOrderChangeRequestSchema,
  createProductionTaskDisputeSchema,
  reviewProductionTaskDisputeSchema,
} from '../schemas';

describe('production task dispute schemas', () => {
  it('trims and accepts auditable create/review payloads', () => {
    const created = createProductionTaskDisputeSchema.parse({
      taskId: 'task-1',
      reason: '  计件数量与实际合格数不一致  ',
    });
    expect(created.reason).toBe('计件数量与实际合格数不一致');

    const reviewed = reviewProductionTaskDisputeSchema.parse({
      disputeId: 'dispute-1',
      decision: 'RESOLVED',
      resolution: '  已核对完成  ',
    });
    expect(reviewed).toEqual({
      disputeId: 'dispute-1',
      decision: 'RESOLVED',
      resolution: '已核对完成',
    });
  });

  it('rejects short reasons, invalid decisions and empty replies', () => {
    expect(
      createProductionTaskDisputeSchema.safeParse({
        taskId: 'task-1',
        reason: '太短',
      }).success,
    ).toBe(false);
    expect(
      reviewProductionTaskDisputeSchema.safeParse({
        disputeId: 'dispute-1',
        decision: 'PENDING',
        resolution: '',
      }).success,
    ).toBe(false);
  });
});

describe('order change request schemas', () => {
  it('接收正反面烫金明细且不要求旧聚合字段', () => {
    const result = createOrderChangeRequestSchema.safeParse({
      orderId: 'order-1',
      reason: '客户改为双面烫金',
      items: [
        {
          operation: 'UPDATE',
          itemId: 'item-1',
          frontFoilColors: [' 哑金 '],
          backFoilColors: ['红金'],
        },
      ],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items[0]).toMatchObject({
        frontFoilColors: ['哑金'],
        backFoilColors: ['红金'],
      });
      expect(result.data.items[0]).not.toHaveProperty('foilColors');
    }
  });

  it('仅为历史客户端保留聚合烫金颜色入参', () => {
    const result = createOrderChangeRequestSchema.safeParse({
      orderId: 'order-1',
      reason: '历史客户端修改颜色',
      items: [
        {
          operation: 'UPDATE',
          itemId: 'item-1',
          foilColors: ['浅金', '红金', '银色', '蓝金', '古铜金'],
        },
      ],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items[0]).toMatchObject({
        foilColors: ['浅金', '红金', '银色', '蓝金', '古铜金'],
      });
    }
  });

  it('rejects duplicate UPDATE entries for one item to avoid approval-order ambiguity', () => {
    const result = createOrderChangeRequestSchema.safeParse({
      orderId: 'order-1',
      reason: '客户修改数量和规格',
      items: [
        { operation: 'UPDATE', itemId: 'item-1', quantity: 1200 },
        { operation: 'UPDATE', itemId: 'item-1', specification: '大号' },
      ],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ['items', 1, 'itemId'],
            message: '同一款式不能重复提交修改',
          }),
        ]),
      );
    }
  });
});

describe('outsource mutation schemas', () => {
  const requestKey = '00000000-0000-4000-8000-000000000001';
  const createPayload = {
    idempotencyKey: requestKey,
    orderId: 'order-1',
    orderItemIds: ['item-1'],
    supplierName: '外协厂',
    supplierContact: null,
    craftDescription: null,
    specialRequirement: null,
    totalQty: null,
    expectedDate: null,
    amount: null,
    remark: null,
  };

  it('requires a UUID for retry-safe outsource creation', () => {
    expect(createOutsourceSchema.safeParse(createPayload).success).toBe(true);
    expect(
      createOutsourceSchema.safeParse({
        ...createPayload,
        idempotencyKey: 'not-a-uuid',
      }).success,
    ).toBe(false);
  });

  it('rejects selecting the same order item more than once', () => {
    const result = createOutsourceSchema.safeParse({
      ...createPayload,
      orderItemIds: ['item-1', 'item-1'],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ['orderItemIds'],
            message: '不能重复选择同一款式',
          }),
        ]),
      );
    }
  });

  it('accepts the derived total for multiple maximum-sized styles', () => {
    expect(
      createOutsourceSchema.safeParse({
        ...createPayload,
        orderItemIds: ['item-1', 'item-2'],
        totalQty: 19_999_998,
      }).success,
    ).toBe(true);
  });

  it('validates confirmed outsource money and its audit reason', () => {
    expect(
      confirmOutsourceAmountSchema.safeParse({
        idempotencyKey: requestKey,
        amount: '0.00',
        reason: '免费重做',
      }).success,
    ).toBe(true);
    expect(
      confirmOutsourceAmountSchema.safeParse({
        idempotencyKey: requestKey,
        amount: '9999999999.99',
        reason: '最终对账',
      }).success,
    ).toBe(true);
    for (const amount of ['', '-1', '10000000000.00', '1.001']) {
      expect(
        confirmOutsourceAmountSchema.safeParse({
          idempotencyKey: requestKey,
          amount,
          reason: '最终对账',
        }).success,
      ).toBe(false);
    }
    expect(
      confirmOutsourceAmountSchema.safeParse({
        idempotencyKey: requestKey,
        amount: '10.00',
        reason: ' ',
      }).success,
    ).toBe(false);
  });

  it('parses a positive external payment and Shanghai wall time exactly', () => {
    const parsed = recordOutsourcePaymentSchema.parse({
      idempotencyKey: requestKey,
      amount: '0.01',
      paidAt: '2026-08-07T12:30',
      method: ' 银行转账 ',
      reference: '',
      remark: ' 首付款 ',
    });
    expect(parsed).toEqual({
      idempotencyKey: requestKey,
      amount: '0.01',
      paidAt: new Date('2026-08-07T04:30:00.000Z'),
      method: '银行转账',
      reference: null,
      remark: '首付款',
    });
  });

  it('enforces exact positive Decimal(12,2) payment bounds', () => {
    expect(
      recordOutsourcePaymentSchema.safeParse({
        idempotencyKey: requestKey,
        amount: '9999999999.99',
        paidAt: '2026-08-07T12:30',
        method: '',
        reference: '',
        remark: '',
      }).success,
    ).toBe(true);
    for (const amount of ['0', '0.00', '-1', '1.001', '10000000000.00', 'abc']) {
      expect(
        recordOutsourcePaymentSchema.safeParse({
          idempotencyKey: requestKey,
          amount,
          paidAt: '2026-08-07T12:30',
          method: '',
          reference: '',
          remark: '',
        }).success,
      ).toBe(false);
    }
  });

  it('rejects invalid payment keys, calendar dates, incomplete times, and timezone suffixes', () => {
    for (const [field, value] of [
      ['idempotencyKey', 'not-a-uuid'],
      ['paidAt', '2026-02-30T12:30'],
      ['paidAt', '2026-08-07T12'],
      ['paidAt', '2026-08-07T12:30Z'],
    ] as const) {
      expect(
        recordOutsourcePaymentSchema.safeParse({
          idempotencyKey: requestKey,
          amount: '1.00',
          paidAt: '2026-08-07T12:30',
          method: '',
          reference: '',
          remark: '',
          [field]: value,
        }).success,
      ).toBe(false);
    }
  });

  it('accepts a valid leap-day payment date and enforces optional text limits', () => {
    expect(
      recordOutsourcePaymentSchema.safeParse({
        idempotencyKey: requestKey,
        amount: '1.00',
        paidAt: '2028-02-29T23:59',
        method: 'm'.repeat(32),
        reference: 'r'.repeat(64),
        remark: 'x'.repeat(200),
      }).success,
    ).toBe(true);
    for (const [field, value] of [
      ['method', 'm'.repeat(33)],
      ['reference', 'r'.repeat(65)],
      ['remark', 'x'.repeat(201)],
    ] as const) {
      expect(
        recordOutsourcePaymentSchema.safeParse({
          idempotencyKey: requestKey,
          amount: '1.00',
          paidAt: '2028-02-29T23:59',
          method: '',
          reference: '',
          remark: '',
          [field]: value,
        }).success,
      ).toBe(false);
    }
  });
});

describe('loginSchema', () => {
  it('accepts a valid pair', () => {
    const parsed = loginSchema.parse({ username: 'admin', password: 'admin@2026' });
    expect(parsed).toEqual({ username: 'admin', password: 'admin@2026' });
  });

  it('trims surrounding whitespace in username', () => {
    const parsed = loginSchema.parse({ username: '  admin  ', password: 'goodpass' });
    expect(parsed.username).toBe('admin');
  });

  it('rejects empty username', () => {
    const result = loginSchema.safeParse({ username: '', password: 'goodpass' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('请输入用户名');
    }
  });

  it('rejects whitespace-only username (after trim)', () => {
    const result = loginSchema.safeParse({ username: '   ', password: 'goodpass' });
    expect(result.success).toBe(false);
  });

  it('rejects overly long username', () => {
    const result = loginSchema.safeParse({
      username: 'a'.repeat(65),
      password: 'goodpass',
    });
    expect(result.success).toBe(false);
  });

  it('rejects password shorter than 8 (decision A)', () => {
    const result = loginSchema.safeParse({ username: 'admin', password: 'short7_' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('密码至少 8 位');
    }
  });

  it('accepts exactly 8-character password', () => {
    const result = loginSchema.safeParse({ username: 'admin', password: '12345678' });
    expect(result.success).toBe(true);
  });

  it('rejects overly long password', () => {
    const result = loginSchema.safeParse({
      username: 'admin',
      password: 'a'.repeat(257),
    });
    expect(result.success).toBe(false);
  });
});

describe('changePasswordSchema', () => {
  const valid = {
    currentPassword: 'old-one-123',
    newPassword: 'brand-new-secret',
    confirmPassword: 'brand-new-secret',
  };

  it('accepts a valid change', () => {
    expect(changePasswordSchema.safeParse(valid).success).toBe(true);
  });

  it('requires currentPassword', () => {
    const r = changePasswordSchema.safeParse({ ...valid, currentPassword: '' });
    expect(r.success).toBe(false);
  });

  it('rejects new password shorter than 8', () => {
    const r = changePasswordSchema.safeParse({
      ...valid,
      newPassword: 'short7_',
      confirmPassword: 'short7_',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.message === '新密码至少 8 位')).toBe(true);
    }
  });

  it('rejects when confirmPassword does not match', () => {
    const r = changePasswordSchema.safeParse({ ...valid, confirmPassword: 'different-1' });
    expect(r.success).toBe(false);
    if (!r.success) {
      const issue = r.error.issues.find((i) => i.path[0] === 'confirmPassword');
      expect(issue?.message).toBe('两次输入的新密码不一致');
    }
  });

  it('rejects when new password equals current password', () => {
    const same = 'samepassword123';
    const r = changePasswordSchema.safeParse({
      currentPassword: same,
      newPassword: same,
      confirmPassword: same,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const issue = r.error.issues.find((i) => i.path[0] === 'newPassword');
      expect(issue?.message).toBe('新密码不能与当前密码相同');
    }
  });

  describe('bcrypt 72-byte ceiling on newPassword (Codex round 10 / P1)', () => {
    it('accepts exactly 72 ASCII bytes', () => {
      const new72 = 'a'.repeat(72); // 72 bytes in UTF-8
      const r = changePasswordSchema.safeParse({
        currentPassword: 'old-one-123',
        newPassword: new72,
        confirmPassword: new72,
      });
      expect(r.success).toBe(true);
    });

    it('rejects 73 ASCII bytes (via char-count short-circuit, not byte refine)', () => {
      // 73 ASCII chars == 73 bytes; .max(72) fires first, which is what we
      // want (Codex round 11 — avoid an unnecessary TextEncoder.encode).
      const new73 = 'a'.repeat(73);
      const r = changePasswordSchema.safeParse({
        currentPassword: 'old-one-123',
        newPassword: new73,
        confirmPassword: new73,
      });
      expect(r.success).toBe(false);
      if (!r.success) {
        const issue = r.error.issues.find((i) => i.path[0] === 'newPassword');
        expect(issue?.message).toMatch(/最多 72 字符/);
      }
    });

    it('accepts 24 Chinese characters (72 UTF-8 bytes)', () => {
      const new24cn = '密码'.repeat(12); // 24 Chinese chars × 3 bytes = 72
      expect(new TextEncoder().encode(new24cn).length).toBe(72);
      const r = changePasswordSchema.safeParse({
        currentPassword: 'old-one-123',
        newPassword: new24cn,
        confirmPassword: new24cn,
      });
      expect(r.success).toBe(true);
    });

    it('rejects 25 Chinese characters (75 UTF-8 bytes) even though the char count is tiny', () => {
      const new25cn = '密码'.repeat(12) + '长'; // 75 bytes
      expect(new TextEncoder().encode(new25cn).length).toBe(75);
      const r = changePasswordSchema.safeParse({
        currentPassword: 'old-one-123',
        newPassword: new25cn,
        confirmPassword: new25cn,
      });
      expect(r.success).toBe(false);
    });

    it('rejects long emoji passphrase that is visually short but byte-long', () => {
      // Each 👩‍🔬 is 11 UTF-8 bytes (emoji + ZWJ + emoji).
      const scientist = '👩‍🔬'.repeat(8); // 88 bytes, only 8 "characters" visually
      const r = changePasswordSchema.safeParse({
        currentPassword: 'old-one-123',
        newPassword: scientist,
        confirmPassword: scientist,
      });
      expect(r.success).toBe(false);
    });

    it('rejects pathological oversize by char count (Codex round 11)', () => {
      const huge = 'a'.repeat(10_000);
      const r = changePasswordSchema.safeParse({
        currentPassword: 'old-one-123',
        newPassword: huge,
        confirmPassword: huge,
      });
      expect(r.success).toBe(false);
      if (!r.success) {
        const issue = r.error.issues.find((i) => i.path[0] === 'newPassword');
        expect(issue?.message).toMatch(/最多 72 字符/);
      }
    });

    it('short-circuits before TextEncoder.encode for oversize input (Codex round 12)', () => {
      // The invariant we're locking in: Zod's checks run even after .max()
      // fails, so a naive `.max(72).refine(encodeCheck)` would still allocate
      // a 10k-byte Uint8Array for a 10k-char payload. The superRefine's
      // early return must keep TextEncoder.encode out of the hot path.
      const spy = vi.spyOn(TextEncoder.prototype, 'encode');
      const huge = 'a'.repeat(10_000);

      try {
        const r = changePasswordSchema.safeParse({
          currentPassword: 'old-one-123',
          newPassword: huge,
          confirmPassword: huge,
        });
        expect(r.success).toBe(false);
        for (const call of spy.mock.calls) {
          // `call[0]` is the string passed to encode. None of our code paths
          // should have encoded the oversize payload.
          expect(call[0]).not.toBe(huge);
          if (typeof call[0] === 'string') {
            expect(call[0].length).toBeLessThanOrEqual(MAX_PASSWORD_CHARS);
          }
        }
      } finally {
        spy.mockRestore();
      }
    });
  });
});

const MAX_PASSWORD_CHARS = 72;

// ─────────────────────────────────────────────────────────────────────
// Owner-side account schemas
// ─────────────────────────────────────────────────────────────────────

const validCreate = {
  username: 'alice',
  displayName: 'Alice',
  phone: '',
  role: Role.SALES,
  workerType: null,
  machineType: null,
  password: 'secret-pass-1',
};

describe('createUserSchema', () => {
  describe('username', () => {
    it('rejects under 3 chars', () => {
      const r = createUserSchema.safeParse({ ...validCreate, username: 'ab' });
      expect(r.success).toBe(false);
    });
    it('rejects invalid chars (spaces, CJK, slashes)', () => {
      for (const bad of ['alice x', '管理员', 'a/b', 'a@b', 'a.b']) {
        const r = createUserSchema.safeParse({ ...validCreate, username: bad });
        expect(r.success, bad).toBe(false);
      }
    });
    it('accepts letters / digits / underscore / hyphen', () => {
      for (const ok of ['alice', 'A1_b-c', 'u_123', 'sales-01']) {
        const r = createUserSchema.safeParse({ ...validCreate, username: ok });
        expect(r.success, ok).toBe(true);
      }
    });
    it('trims surrounding whitespace', () => {
      const r = createUserSchema.parse({ ...validCreate, username: '  alice  ' });
      expect(r.username).toBe('alice');
    });
  });

  describe('enforceWorkerCascade', () => {
    it('requires workerType when role=WORKER', () => {
      const r = createUserSchema.safeParse({
        ...validCreate,
        role: Role.WORKER,
        employmentType: EmploymentType.FULL_TIME,
        workerType: null,
      });
      expect(r.success).toBe(false);
      if (!r.success) {
        const issue = r.error.issues.find((i) => i.path[0] === 'workerType');
        expect(issue?.message).toMatch(/岗位类型/);
      }
    });

    it('requires machineType when workerType=MACHINE', () => {
      const r = createUserSchema.safeParse({
        ...validCreate,
        role: Role.WORKER,
        employmentType: EmploymentType.FULL_TIME,
        workerType: WorkerType.MACHINE,
        machineType: null,
      });
      expect(r.success).toBe(false);
      if (!r.success) {
        const issue = r.error.issues.find((i) => i.path[0] === 'machineType');
        expect(issue?.message).toMatch(/机器类型/);
      }
    });

    it('accepts WORKER + MACHINE + machineType', () => {
      const r = createUserSchema.safeParse({
        ...validCreate,
        role: Role.WORKER,
        employmentType: EmploymentType.FULL_TIME,
        workerType: WorkerType.MACHINE,
        machineType: MachineType.HAND_PRESS,
      });
      expect(r.success).toBe(true);
    });

    it('accepts WORKER + PACKER without machineType', () => {
      const r = createUserSchema.safeParse({
        ...validCreate,
        role: Role.WORKER,
        employmentType: EmploymentType.FULL_TIME,
        workerType: WorkerType.PACKER,
        machineType: null,
      });
      expect(r.success).toBe(true);
    });

    it('rejects machineType on non-MACHINE worker', () => {
      const r = createUserSchema.safeParse({
        ...validCreate,
        role: Role.WORKER,
        employmentType: EmploymentType.FULL_TIME,
        workerType: WorkerType.PACKER,
        machineType: MachineType.WINDMILL,
      });
      expect(r.success).toBe(false);
    });

    it('rejects workerType on non-WORKER role', () => {
      const r = createUserSchema.safeParse({
        ...validCreate,
        role: Role.SALES,
        workerType: WorkerType.MACHINE,
      });
      expect(r.success).toBe(false);
    });

    it('rejects machineType on non-WORKER role', () => {
      const r = createUserSchema.safeParse({
        ...validCreate,
        role: Role.SALES,
        machineType: MachineType.WINDMILL,
      });
      expect(r.success).toBe(false);
    });
  });

  it('enforces the bcrypt 72-byte ceiling on password (shared helper)', () => {
    const long = 'a'.repeat(73);
    const r = createUserSchema.safeParse({ ...validCreate, password: long });
    expect(r.success).toBe(false);
  });

  it('keeps external sales out of employee payroll semantics', () => {
    expect(createUserSchema.safeParse(validCreate).success).toBe(true);
    const invalid = createUserSchema.safeParse({
      ...validCreate,
      employmentType: EmploymentType.FULL_TIME,
      employmentStartDate: '2026-08-01',
    });
    expect(invalid.success).toBe(false);
  });

  it('requires employment type for internal customer service', () => {
    expect(
      createUserSchema.safeParse({
        ...validCreate,
        role: Role.CUSTOMER_SERVICE,
      }).success,
    ).toBe(false);
    expect(
      createUserSchema.safeParse({
        ...validCreate,
        role: Role.CUSTOMER_SERVICE,
        employmentType: EmploymentType.FULL_TIME,
      }).success,
    ).toBe(true);
  });
});

describe('updateUserSchema', () => {
  const validUpdate = {
    displayName: 'Alice',
    phone: '',
    role: Role.SALES,
    workerType: null,
    machineType: null,
  };

  it('accepts a valid shape', () => {
    expect(updateUserSchema.safeParse(validUpdate).success).toBe(true);
  });

  it('does not include isActive (activation is owned by setUserActive)', () => {
    const r = updateUserSchema.safeParse({ ...validUpdate, isActive: 'on' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect('isActive' in r.data).toBe(false);
    }
  });

  it('reuses the same enforceWorkerCascade refinement', () => {
    const r = updateUserSchema.safeParse({ ...validUpdate, role: Role.WORKER });
    expect(r.success).toBe(false);
  });
});

describe('resetUserPasswordSchema', () => {
  it('accepts an 8+ char new password', () => {
    expect(resetUserPasswordSchema.safeParse({ newPassword: '12345678' }).success).toBe(true);
  });
  it('rejects short passwords', () => {
    const r = resetUserPasswordSchema.safeParse({ newPassword: 'short7_' });
    expect(r.success).toBe(false);
  });
  it('rejects >72-char passwords', () => {
    const r = resetUserPasswordSchema.safeParse({ newPassword: 'a'.repeat(73) });
    expect(r.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Craft dictionary schemas (P0 #2)
// ─────────────────────────────────────────────────────────────────────

const validCraft = {
  name: '专版单色平烫',
  code: 'FLAT_FOIL_SINGLE',
  isOutsource: 'false',
  sortOrder: '20',
};

describe('createCraftSchema', () => {
  it('accepts a SPEC §6.1 entry as-is', () => {
    const r = createCraftSchema.safeParse(validCraft);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.sortOrder).toBe(20); // coerced from string
      expect(r.data.isOutsource).toBe(false);
    }
  });

  describe('code', () => {
    it('normalizes a blank create code to null for automatic generation', () => {
      const r = createCraftSchema.safeParse({ ...validCraft, code: '' });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.code).toBeNull();
    });

    it('rejects lowercase', () => {
      const r = createCraftSchema.safeParse({ ...validCraft, code: 'flat_foil_single' });
      expect(r.success).toBe(false);
    });
    it('rejects leading digit', () => {
      const r = createCraftSchema.safeParse({ ...validCraft, code: '1FLAT' });
      expect(r.success).toBe(false);
    });
    it('rejects hyphen / dot', () => {
      for (const bad of ['FLAT-FOIL', 'FLAT.FOIL']) {
        const r = createCraftSchema.safeParse({ ...validCraft, code: bad });
        expect(r.success, bad).toBe(false);
      }
    });
    it('accepts underscores and trailing digits', () => {
      for (const ok of ['STOCK_FOIL', 'COLOR_PRINT_FOIL', 'UV', 'FOIL2']) {
        const r = createCraftSchema.safeParse({ ...validCraft, code: ok });
        expect(r.success, ok).toBe(true);
      }
    });
    it('requires at least 2 chars', () => {
      const r = createCraftSchema.safeParse({ ...validCraft, code: 'A' });
      expect(r.success).toBe(false);
    });
  });

  describe('sortOrder', () => {
    it('coerces decimal strings via z.coerce.number → int check fails', () => {
      const r = createCraftSchema.safeParse({ ...validCraft, sortOrder: '3.5' });
      expect(r.success).toBe(false);
    });
    it('rejects negative numbers', () => {
      const r = createCraftSchema.safeParse({ ...validCraft, sortOrder: '-1' });
      expect(r.success).toBe(false);
    });
    it('rejects 0 — new crafts must pick a positive sortOrder (Codex round 18 / P2)', () => {
      const r = createCraftSchema.safeParse({ ...validCraft, sortOrder: '0' });
      expect(r.success).toBe(false);
      if (!r.success) {
        const issue = r.error.issues.find((i) => i.path[0] === 'sortOrder');
        expect(issue?.message).toMatch(/≥ 1/);
      }
    });
    it("rejects empty string (coerces to 0 then trips the min)", () => {
      const r = createCraftSchema.safeParse({ ...validCraft, sortOrder: '' });
      expect(r.success).toBe(false);
    });
    it('accepts 1 (tight boundary)', () => {
      const r = createCraftSchema.safeParse({ ...validCraft, sortOrder: '1' });
      expect(r.success).toBe(true);
    });
    it('rejects non-numeric strings', () => {
      const r = createCraftSchema.safeParse({ ...validCraft, sortOrder: 'abc' });
      expect(r.success).toBe(false);
    });
  });

  describe('isOutsource (formBoolean reuse)', () => {
    it.each([
      ['on', true],
      ['true', true],
      [undefined, false],
      ['', false],
      ['false', false],
    ])('maps %j → %j', (raw, expected) => {
      const r = createCraftSchema.safeParse({ ...validCraft, isOutsource: raw });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.isOutsource).toBe(expected);
    });
  });
});

describe('updateCraftSchema', () => {
  const validUpdate = { ...validCraft };

  it('accepts a valid shape and strips any submitted isActive', () => {
    const r = updateCraftSchema.safeParse({ ...validUpdate, isActive: 'on' });
    expect(r.success).toBe(true);
    if (r.success) expect('isActive' in r.data).toBe(false);
  });

  it('忽略客户端提交的内部编号', () => {
    const r = updateCraftSchema.safeParse({ ...validUpdate, code: 'bad-code' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).not.toHaveProperty('code');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Product dictionary (P0 #2 Slice B)
// ─────────────────────────────────────────────────────────────────────

const validProduct = {
  code: '',
  categoryNodeId: 'cat_blank_stock',
  name: '空白红包',
  specification: '',
  paperType: '',
};

describe('createProductSchema', () => {
  it('accepts a typical entry', () => {
    const r = createProductSchema.safeParse(validProduct);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.specification).toBeNull();
    }
  });

  it('丢弃旧产品单价与起订量字段', () => {
    const r = createProductSchema.safeParse({
      ...validProduct,
      baseUnitPrice: '0.12',
      minOrderQty: '1000',
    });

    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).not.toHaveProperty('baseUnitPrice');
      expect(r.data).not.toHaveProperty('minOrderQty');
    }
  });

  describe('code', () => {
    it('empty string is normalized to null', () => {
      const r = createProductSchema.safeParse({ ...validProduct, code: '' });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.code).toBeNull();
    });

    it.each(['HB001', 'hb001', 'FOIL_STOCK', 'foil-stock-01'])(
      'accepts product code %j',
      (code) => {
        const r = createProductSchema.safeParse({ ...validProduct, code });
        expect(r.success, code).toBe(true);
        if (r.success) expect(r.data.code).toBe(code);
      },
    );

    it.each(['红包001', 'HB 001', 'HB.001', 'HB/001'])(
      'rejects product code %j',
      (code) => {
        const r = createProductSchema.safeParse({ ...validProduct, code });
        expect(r.success, code).toBe(false);
      },
    );
  });

  describe('categoryNodeId', () => {
    it('rejects empty category node id', () => {
      const r = createProductSchema.safeParse({ ...validProduct, categoryNodeId: '' });
      expect(r.success).toBe(false);
    });

    it('trims category node id', () => {
      const r = createProductSchema.safeParse({
        ...validProduct,
        categoryNodeId: '  cat_blank_stock  ',
      });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.categoryNodeId).toBe('cat_blank_stock');
    });
  });

  describe('name / specification / paperType', () => {
    it('trims name; rejects empty after trim', () => {
      const r = createProductSchema.safeParse({ ...validProduct, name: '   ' });
      expect(r.success).toBe(false);
    });
    it('specification + paperType empty → null', () => {
      const r = createProductSchema.safeParse({
        ...validProduct,
        specification: '',
        paperType: '',
      });
      expect(r.success).toBe(true);
      if (r.success) {
        expect(r.data.specification).toBeNull();
        expect(r.data.paperType).toBeNull();
      }
    });
    it('rejects overlong spec / paperType', () => {
      const r1 = createProductSchema.safeParse({
        ...validProduct,
        specification: 'x'.repeat(65),
      });
      expect(r1.success).toBe(false);
      const r2 = createProductSchema.safeParse({
        ...validProduct,
        paperType: 'x'.repeat(33),
      });
      expect(r2.success).toBe(false);
    });
  });
});

describe('updateProductSchema', () => {
  it('accepts a valid shape and strips any submitted isActive', () => {
    const r = updateProductSchema.safeParse({ ...validProduct, isActive: 'on' });
    expect(r.success).toBe(true);
    if (r.success) expect('isActive' in r.data).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Party master data (A16)
// ─────────────────────────────────────────────────────────────────────

const validParty = {
  type: PartyType.CUSTOMER,
  code: 'CUST_001',
  name: '苹果福',
  shortName: '',
  primaryContactName: '王小姐',
  primaryContactPhone: '13800000000',
  primaryContactWechat: '',
  defaultReceiverName: '王小姐',
  defaultReceiverPhone: '13800000000',
  defaultProvince: '广东',
  defaultCity: '广州',
  defaultDistrict: '番禺',
  defaultAddressDetail: '市桥街道 1 号',
};

describe('createPartySchema', () => {
  it('normalizes a blank create code to null for automatic generation', () => {
    const r = createPartySchema.safeParse({ ...validParty, code: '' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.code).toBeNull();
  });

  it('accepts a customer party and normalizes blank optional fields to null', () => {
    const r = createPartySchema.safeParse(validParty);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.type).toBe(PartyType.CUSTOMER);
      expect(r.data.shortName).toBeNull();
      expect(r.data.primaryContactWechat).toBeNull();
    }
  });

  it('accepts supplier and both party types', () => {
    expect(createPartySchema.safeParse({ ...validParty, type: PartyType.SUPPLIER }).success).toBe(true);
    expect(createPartySchema.safeParse({ ...validParty, type: PartyType.BOTH }).success).toBe(true);
  });

  it('rejects non-code-safe values', () => {
    for (const code of ['苹果福', 'CUST 001', 'CUST.001', 'CUST/001']) {
      const r = createPartySchema.safeParse({ ...validParty, code });
      expect(r.success, code).toBe(false);
    }
  });

  it('rejects an empty name after trim', () => {
    const r = createPartySchema.safeParse({ ...validParty, name: '   ' });
    expect(r.success).toBe(false);
  });
});

describe('updatePartySchema', () => {
  it('keeps code required for existing master data', () => {
    expect(updatePartySchema.safeParse({ ...validParty, code: '' }).success).toBe(
      false,
    );
  });
});

describe('auto-generated master-data code schemas', () => {
  const material = {
    code: '',
    name: 'A4 白卡纸',
    category: 'PAPER',
    specification: '',
    unit: '张',
    safetyStock: '',
    averageCost: '',
  };

  it('accepts blank codes on material, warehouse, and location creation', () => {
    const materialResult = createMaterialSchema.safeParse(material);
    const warehouseResult = createWarehouseSchema.safeParse({
      code: '',
      name: '一号仓',
    });
    const locationResult = createWarehouseLocationSchema.safeParse({
      warehouseId: 'wh1',
      code: '',
      name: 'A01',
    });

    expect(materialResult.success).toBe(true);
    expect(warehouseResult.success).toBe(true);
    expect(locationResult.success).toBe(true);
    if (materialResult.success) expect(materialResult.data.code).toBeNull();
    if (warehouseResult.success) expect(warehouseResult.data.code).toBeNull();
    if (locationResult.success) expect(locationResult.data.code).toBeNull();
  });

  it('keeps material code required on edit', () => {
    expect(updateMaterialSchema.safeParse(material).success).toBe(false);
  });

  it('字典枚举异常时只返回业务文案', () => {
    const categoryResult = createProductCategoryNodeSchema.safeParse({
      parentId: '',
      name: '测试分类',
      legacyCategory: 'INTERNAL_PRODUCT_CATEGORY',
      sortOrder: '10',
    });
    const materialResult = createMaterialSchema.safeParse({
      ...material,
      category: 'INTERNAL_MATERIAL_CATEGORY',
    });

    expect(categoryResult.success).toBe(false);
    expect(materialResult.success).toBe(false);
    if (!categoryResult.success && !materialResult.success) {
      const visibleErrors = [
        ...categoryResult.error.issues,
        ...materialResult.error.issues,
      ]
        .map((issue) => issue.message)
        .join('\n');
      expect(visibleErrors).toContain('请选择有效的产品分类');
      expect(visibleErrors).toContain('请选择有效的物料分类');
      expect(visibleErrors).not.toContain('INTERNAL_PRODUCT_CATEGORY');
      expect(visibleErrors).not.toContain('INTERNAL_MATERIAL_CATEGORY');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// Purchase schemas (A17)
// ─────────────────────────────────────────────────────────────────────

const validPurchaseOrder = {
  supplierPartyId: 'supplier_1',
  materialId: 'mat_1',
  quantity: '10.00',
  unitCost: '1.2300',
  expectedDate: '2026-07-01',
  remark: '',
};

describe('createPurchaseOrderSchema', () => {
  it('accepts a valid purchase order and normalizes blank remark', () => {
    const r = createPurchaseOrderSchema.safeParse(validPurchaseOrder);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.quantity).toBe('10.00');
      expect(r.data.unitCost).toBe('1.2300');
      expect(r.data.remark).toBeNull();
    }
  });

  it('accepts a blank expected date as null', () => {
    const r = createPurchaseOrderSchema.safeParse({
      ...validPurchaseOrder,
      expectedDate: '',
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.expectedDate).toBeNull();
  });

  it('rejects non-positive or malformed quantities', () => {
    for (const quantity of ['0', '-1', 'abc', '1.234']) {
      const r = createPurchaseOrderSchema.safeParse({
        ...validPurchaseOrder,
        quantity,
      });
      expect(r.success, quantity).toBe(false);
    }
  });
});

describe('createPurchaseReceiptSchema', () => {
  it('accepts a receipt quantity and optional unit cost', () => {
    const r = createPurchaseReceiptSchema.safeParse({
      idempotencyKey: '00000000-0000-4000-8000-000000000001',
      purchaseOrderItemId: 'poi_1',
      quantity: '3.50',
      unitCost: '',
      remark: '到货一部分',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.unitCost).toBeNull();
      expect(r.data.remark).toBe('到货一部分');
    }
  });
});

describe('cancelPurchaseReceiptSchema', () => {
  it('requires a non-blank reason and trims the accepted value', () => {
    const blank = cancelPurchaseReceiptSchema.safeParse({ reason: '   ' });
    expect(blank.success).toBe(false);
    if (!blank.success) {
      expect(blank.error.issues[0]?.message).toBe('请填写取消原因');
    }

    const valid = cancelPurchaseReceiptSchema.safeParse({
      reason: '  供应商送错物料  ',
    });
    expect(valid.success).toBe(true);
    if (valid.success) expect(valid.data.reason).toBe('供应商送错物料');
  });
});

describe('warehouse operation schemas', () => {
  const idempotencyKey = '00000000-0000-4000-8000-000000000001';

  it('accepts a positive stock transfer and rejects zero quantity', () => {
    const valid = {
      idempotencyKey,
      materialId: 'mat_1',
      sourceLocationId: 'loc_a',
      destinationLocationId: 'loc_b',
      quantity: '1.25',
      remark: '',
    };
    expect(createStockTransferSchema.safeParse(valid).success).toBe(true);
    expect(
      createStockTransferSchema.safeParse({ ...valid, quantity: '0' }).success,
    ).toBe(false);
  });

  it('accepts zero as a real inventory count and requires at least one item', () => {
    const valid = {
      idempotencyKey,
      remark: '月末例行盘点',
      items: [
        {
          materialId: 'mat_1',
          locationId: 'loc_a',
          bookQuantity: '3.00',
          countedQuantity: '0',
        },
      ],
    };
    expect(postInventoryCountSchema.safeParse(valid).success).toBe(true);
    expect(
      postInventoryCountSchema.safeParse({ ...valid, items: [] }).success,
    ).toBe(false);
    expect(
      postInventoryCountSchema.safeParse({ ...valid, remark: '   ' }).success,
    ).toBe(false);
  });

  it('缺账面数快照时 fail closed，且消息是中文', () => {
    // 旧版页面（部署窗口里还开着的浏览器）提交上来就是这个形状。zod v4 缺字段
    // 走 invalid_type 分支，.regex() 的消息不触发——所以字段本身带了 error 参数。
    const result = postInventoryCountSchema.safeParse({
      idempotencyKey,
      remark: '复核库存差异',
      items: [
        { materialId: 'mat_1', locationId: 'loc_a', countedQuantity: '8.00' },
      ],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      '缺少账面数快照，请刷新页面后重新盘点',
    );
  });
});

describe('materialStockTransactionSchema', () => {
  const base = {
    materialId: 'mat_1',
    locationId: '',
    direction: 'IN',
    quantity: '1.00',
    unitCost: '',
    remark: '',
  };

  it('rejects purchase and inventory-count reasons on the manual endpoint', () => {
    for (const reasonType of ['PURCHASE', 'PURCHASE_RECEIPT', 'ADJUSTMENT']) {
      expect(
        materialStockTransactionSchema.safeParse({ ...base, reasonType }).success,
        reasonType,
      ).toBe(false);
    }
  });

  it('enforces the relationship between movement direction and reason', () => {
    expect(
      materialStockTransactionSchema.safeParse({
        ...base,
        reasonType: 'RETURN',
      }).success,
    ).toBe(true);
    expect(
      materialStockTransactionSchema.safeParse({
        ...base,
        reasonType: 'PRODUCTION_USE',
      }).success,
    ).toBe(false);
    expect(
      materialStockTransactionSchema.safeParse({
        ...base,
        direction: 'OUT',
        reasonType: 'PRODUCTION_USE',
      }).success,
    ).toBe(true);
  });
});

describe('createOrderSchema foil colors', () => {
  const order = {
    customerRef: null,
    receiverName: null,
    receiverPhone: null,
    receiverAddress: '佛山市南海区测试路 1 号',
    expressCode: null,
    packageRequirement: null,
    remark: null,
    promisedDate: null,
    isUrgent: false,
    isSfCollect: false,
    items: [
      {
        name: '多色烫金款',
        productId: 'product-1',
        pricingRoute: 'STOCK_BLANK',
        productStructure: 'STANDARD_ENVELOPE',
        manualQuoteReason: null,
        specification: '大号',
        paperType: '160g珠光艳闪',
        paperWeightGsm: 160,
        quantity: 1000,
        crafts: ['craft-1'],
        foilColors: ['哑金', '红金', ' 古铜金 '],
        foilTechnique: 'FLAT',
        hasLocalFoil: true,
        printColors: [],
        isDoubleSided: false,
        isDoubleColor: false,
        unitPrice: null,
        suggestedSubtotal: null,
        remark: null,
      },
    ],
  };

  it('accepts and trims up to three foil colors on one side', () => {
    const result = createOrderSchema.safeParse(order);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items[0]?.foilColors).toEqual([
        '哑金',
        '红金',
        '古铜金',
      ]);
    }
  });

  it('保留选中的客户主数据编号，并将空选择规范为 null', () => {
    const selected = createOrderSchema.parse({
      ...order,
      customerPartyId: '  customer-1  ',
    });
    const temporary = createOrderSchema.parse({
      ...order,
      customerPartyId: '',
    });

    expect(selected.customerPartyId).toBe('customer-1');
    expect(temporary.customerPartyId).toBeNull();
  });

  it('defaults an omitted color array to empty for compatibility', () => {
    const item = {
      ...order.items[0],
      pricingRoute: 'COLOR_PRINT' as const,
      actualWidthMm: 90,
      actualHeightMm: 165,
      paperType: '200g铜版纸',
      paperWeightGsm: 200,
      foilTechnique: 'NONE' as const,
      hasLocalFoil: false,
      printColors: ['C', 'M', 'Y', 'K'],
    };
    delete (item as Partial<typeof item>).foilColors;
    const result = createOrderSchema.safeParse({ ...order, items: [item] });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.items[0]?.foilColors).toEqual([]);
  });

  it.each([
    ['缺失', undefined],
    ['null', null],
    ['空字符串', ''],
    ['纯空格', '   '],
  ])('拒绝%s的主收货地址', (_label, receiverAddress) => {
    const result = createOrderSchema.safeParse({
      ...order,
      receiverAddress,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ['receiverAddress'],
            message: '请填写收货地址',
          }),
        ]),
      );
    }
  });

  it('accepts a multi-address quantity split and keeps the primary remainder', () => {
    const result = createOrderSchema.safeParse({
      ...order,
      items: [
        { ...order.items[0], quantity: 1000 },
        { ...order.items[0], name: '第二款', quantity: 500 },
      ],
      additionalShipments: [
        {
          receiverName: '分地址客户',
          receiverPhone: '13900000000',
          receiverAddress: '广州分地址',
          expressCode: 'SF',
          itemQuantities: [300, 100],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty, over-allocated, or all-quantity extra addresses', () => {
    const empty = createOrderSchema.safeParse({
      ...order,
      additionalShipments: [
        {
          receiverName: '空分配',
          receiverPhone: null,
          receiverAddress: null,
          expressCode: null,
          itemQuantities: [0],
        },
      ],
    });
    expect(empty.success).toBe(false);

    const overAllocated = createOrderSchema.safeParse({
      ...order,
      additionalShipments: [
        {
          receiverName: '超额分配',
          receiverPhone: null,
          receiverAddress: null,
          expressCode: null,
          itemQuantities: [1001],
        },
      ],
    });
    expect(overAllocated.success).toBe(false);

    const noPrimaryRemainder = createOrderSchema.safeParse({
      ...order,
      additionalShipments: [
        {
          receiverName: '全部分走',
          receiverPhone: null,
          receiverAddress: null,
          expressCode: null,
          itemQuantities: [1000],
        },
      ],
    });
    expect(noPrimaryRemainder.success).toBe(false);

    const mismatchedItemCount = createOrderSchema.safeParse({
      ...order,
      items: [
        { ...order.items[0], quantity: 1000 },
        { ...order.items[0], name: '第二款', quantity: 500 },
      ],
      additionalShipments: [
        {
          receiverName: '少一项分配',
          receiverPhone: null,
          receiverAddress: '广州分地址',
          expressCode: null,
          itemQuantities: [100],
        },
      ],
    });
    expect(mismatchedItemCount.success).toBe(false);
  });

  it('normalizes 顺丰到付 checkbox values and preserves partial updates', () => {
    const checked = createOrderSchema.safeParse({
      ...order,
      isSfCollect: 'on',
    });
    expect(checked.success).toBe(true);
    if (checked.success) expect(checked.data.isSfCollect).toBe(true);

    const omitted = updateEditableOrderSchema.parse({
      expectedEditVersion: '7',
      remark: '保持其他字段',
    });
    expect('receiverAddress' in omitted).toBe(false);
    expect(omitted.expectedEditVersion).toBe(7);
    expect(setOrderSfCollectSchema.parse({ isSfCollect: 'false' })).toEqual({
      isSfCollect: false,
      shipments: [],
    });
    expect(
      setOrderSfCollectSchema.safeParse({}).success,
      '独立切换必须携带明确目标值',
    ).toBe(false);
  });

  it.each([null, '', '   '])(
    '普通编辑只要携带收货地址，就拒绝空值 %#',
    (receiverAddress) => {
      const result = updateEditableOrderSchema.safeParse({
        expectedEditVersion: '7',
        receiverAddress,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ path: ['receiverAddress'] }),
          ]),
        );
      }
    },
  );

  it('普通编辑修剪地址，且不再解析专用的 isSfCollect 字段', () => {
    const parsed = updateEditableOrderSchema.parse({
      expectedEditVersion: '7',
      receiverAddress: '  佛山市南海区测试路 1 号  ',
      isSfCollect: 'true',
    });
    expect(parsed.receiverAddress).toBe('佛山市南海区测试路 1 号');
    expect(parsed).not.toHaveProperty('isSfCollect');
  });

  it.each([undefined, '', 'not-a-version', '-1', '1.5', '01', '9007199254740992'])(
    '普通编辑友好拒绝缺失或非法的编辑版本令牌 %#',
    (expectedEditVersion) => {
      const result = updateEditableOrderSchema.safeParse({
        expectedEditVersion,
        remark: '测试',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              path: ['expectedEditVersion'],
              message: '编辑页面已过期，请刷新后重试',
            }),
          ]),
        );
      }
    },
  );

  it('校验已发货顺丰取消时的逐票快递费更正', () => {
    const valid = setOrderSfCollectSchema.parse({
      isSfCollect: 'false',
      shipments: [
        {
          shipmentId: 'shipment-1',
          destinationProvince: '浙江',
          weightKg: '12.500',
          shippingFee: '',
          customerChargeOverrideReason: '',
        },
      ],
    });
    expect(valid.shipments).toEqual([
      {
        shipmentId: 'shipment-1',
        destinationProvince: '浙江',
        weightKg: '12.500',
        shippingFee: null,
        customerChargeOverrideReason: null,
      },
    ]);

    const duplicate = setOrderSfCollectSchema.safeParse({
      isSfCollect: false,
      shipments: [
        {
          shipmentId: 'shipment-1',
          destinationProvince: '浙江',
          weightKg: '1',
        },
        {
          shipmentId: 'shipment-1',
          destinationProvince: '广东',
          weightKg: '2',
        },
      ],
    });
    expect(duplicate.success).toBe(false);

    for (const shipment of [
      { shipmentId: 'shipment-1', weightKg: '0' },
      { shipmentId: 'shipment-1', weightKg: '1.0000' },
      { shipmentId: 'shipment-1', weightKg: '1', shippingFee: '1.001' },
    ]) {
      expect(
        setOrderSfCollectSchema.safeParse({
          isSfCollect: false,
          shipments: [shipment],
        }).success,
      ).toBe(false);
    }
  });

  it('rejects duplicate colors, more than three colors per side, and no-color mixtures', () => {
    for (const foilColors of [
      ['哑金', '哑金'],
      ['1', '2', '3', '4', '5', '6'],
      ['无颜色（纯彩印）', '哑金'],
    ]) {
      const result = createOrderSchema.safeParse({
        ...order,
        items: [{ ...order.items[0], foilColors }],
      });
      expect(result.success, foilColors.join(',')).toBe(false);
    }
  });

  it('rejects a rounded item subtotal above Decimal(12,2)', () => {
    const withinRange = createOrderSchema.safeParse({
      ...order,
      items: [
        {
          ...order.items[0],
          quantity: 9_999_999,
          unitPrice: '1000',
        },
      ],
    });
    expect(withinRange.success).toBe(true);

    const overflow = createOrderSchema.safeParse({
      ...order,
      items: [
        {
          ...order.items[0],
          quantity: 9_999_999,
          unitPrice: '1000.0001',
        },
      ],
    });
    expect(overflow.success).toBe(false);
    if (!overflow.success) {
      expect(overflow.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ['items', 0, 'unitPrice'],
            message: expect.stringContaining('款式小计过大'),
          }),
        ]),
      );
    }
  });

  it('includes the once-per-item fixed fee in the exact subtotal limit', () => {
    const result = createOrderSchema.safeParse({
      ...order,
      items: [
        {
          ...order.items[0],
          quantity: 9_999_999,
          unitPrice: '1000',
          fixedFee: '1000',
        },
      ],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ['items', 0, 'unitPrice'],
            message: expect.stringContaining('一次性费用'),
          }),
        ]),
      );
    }
  });

  it('keeps once-per-item money at the same two-decimal precision as its database columns', () => {
    const valid = createOrderSchema.safeParse({
      ...order,
      items: [
        {
          ...order.items[0],
          fixedFee: '9999999999.99',
          suggestedSubtotal: '9999999999.99',
          unitPrice: '0',
        },
      ],
    });
    expect(valid.success).toBe(true);

    for (const [field, value] of [
      ['fixedFee', '0.001'],
      ['suggestedSubtotal', '0.001'],
      ['fixedFee', '10000000000.00'],
    ] as const) {
      const result = createOrderSchema.safeParse({
        ...order,
        items: [
          {
            ...order.items[0],
            unitPrice: '0',
            [field]: value,
          },
        ],
      });
      expect(result.success, `${field}=${value}`).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ path: ['items', 0, field] }),
          ]),
        );
      }
    }
  });

  it('rejects an order total above Decimal(12,2) even when each item fits', () => {
    const result = createOrderSchema.safeParse({
      ...order,
      items: [
        {
          ...order.items[0],
          quantity: 5_000_000,
          unitPrice: '1000',
        },
        {
          ...order.items[0],
          name: '第二款',
          quantity: 5_000_000,
          unitPrice: '1000',
        },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ['items'],
            message: expect.stringContaining('工单总金额过大'),
          }),
        ]),
      );
      expect(
        result.error.issues.some((issue) =>
          issue.message.includes('款式小计过大'),
        ),
      ).toBe(false);
    }
  });
});

describe('external-sales shipment charge schemas', () => {
  it('normalizes omitted charge fields and rejects a non-zero SF collect shipping fee', () => {
    const base = {
      customerRef: null,
      receiverName: null,
      receiverPhone: null,
      receiverAddress: '佛山市南海区测试路 1 号',
      expressCode: null,
      packageRequirement: null,
      remark: null,
      promisedDate: null,
      isUrgent: false,
      isSfCollect: false,
      items: [
        {
          name: '测试款',
          productId: 'product-1',
          pricingRoute: 'COLOR_PRINT',
          productStructure: 'STANDARD_ENVELOPE',
          manualQuoteReason: null,
          specification: null,
          paperType: '艳红珠光纸',
          quantity: 500,
          crafts: ['craft-1'],
          foilColors: [],
          foilTechnique: 'NONE',
          hasLocalFoil: false,
          printColors: ['C', 'M', 'Y', 'K'],
          isDoubleSided: false,
          isDoubleColor: false,
          unitPrice: '0.1000',
          fixedFee: '0',
          suggestedSubtotal: null,
          priceOverrideReason: '测试人工报价',
          remark: null,
        },
      ],
    };
    const normalized = createOrderSchema.parse(base);
    expect(normalized).toMatchObject({
      destinationProvince: null,
      quotedWeightKg: null,
      shippingFee: null,
      packingMaterialFee: null,
      customerChargeOverrideReason: null,
    });

    const sfWithShipping = createOrderSchema.safeParse({
      ...base,
      isSfCollect: true,
      shippingFee: '2.80',
      packingMaterialFee: '1.00',
    });
    expect(sfWithShipping.success).toBe(false);
    if (!sfWithShipping.success) {
      expect(sfWithShipping.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ['shippingFee'],
            message: '顺丰到付由客户自行预约，快递费必须为 0',
          }),
        ]),
      );
    }
  });

  it('accepts positive billed weights but rejects the legacy zero sentinel at ship time', () => {
    const input = (weightKg: string) => ({
      trackingNo: null,
      shipments: [
        {
          shipmentId: 'shipment-1',
          trackingNo: null,
          weightKg,
        },
      ],
    });
    expect(shipOrderSchema.safeParse(input('0.5')).success).toBe(true);
    const zero = shipOrderSchema.safeParse(input('0'));
    expect(zero.success).toBe(false);
    if (!zero.success) {
      expect(zero.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ['shipments', 0, 'weightKg'],
            message: '快递重量必须大于 0',
          }),
        ]),
      );
    }
  });
});

describe('finance decimal boundaries', () => {
  it('keeps CS monthly base within Decimal(10,2)', () => {
    const base = {
      csUserId: 'cs-1',
      periodStart: '2026-08-01',
      durationMonths: 1,
      initialSales: '9999999999.99',
    };

    expect(
      startCsPeriodSchema.safeParse({
        ...base,
        monthlyBase: '99999999.99',
      }).success,
    ).toBe(true);
    expect(
      startCsPeriodSchema.safeParse({
        ...base,
        monthlyBase: '100000000.00',
      }).success,
    ).toBe(false);
    expect(
      startCsPeriodSchema.safeParse({
        ...base,
        durationMonths: 4,
        monthlyBase: '99999999.99',
      }).success,
    ).toBe(false);
    expect(
      startCsPeriodSchema.safeParse({
        ...base,
        monthlyBase: -1,
      }).success,
    ).toBe(false);
  });
});

describe('createOrderCostEntrySchema', () => {
  const base = {
    idempotencyKey: '00000000-0000-4000-8000-000000000001',
    orderId: 'order-1',
    category: OrderCostCategory.MATERIAL,
    description: '补录纸张',
    quantity: null,
    unit: null,
    unitPrice: null,
    amount: '1.00',
    remark: null,
  };

  it('matches Decimal(12,3) quantity and Decimal(12,4) unit-price bounds', () => {
    expect(
      createOrderCostEntrySchema.safeParse({
        ...base,
        quantity: '999999999.999',
      }).success,
    ).toBe(true);
    expect(
      createOrderCostEntrySchema.safeParse({
        ...base,
        quantity: '1000000000.000',
      }).success,
    ).toBe(false);

    expect(
      createOrderCostEntrySchema.safeParse({
        ...base,
        unitPrice: '99999999.9999',
      }).success,
    ).toBe(true);
    expect(
      createOrderCostEntrySchema.safeParse({
        ...base,
        unitPrice: '100000000.0000',
      }).success,
    ).toBe(false);
  });

  it('rejects automatic cost categories at the manual entry boundary', () => {
    for (const category of [
      OrderCostCategory.PIECEWORK,
      OrderCostCategory.OUTSOURCE,
    ]) {
      expect(
        createOrderCostEntrySchema.safeParse({ ...base, category }).success,
        category,
      ).toBe(false);
    }
  });

  it('allows negative amounts only for explicit adjustments', () => {
    expect(
      createOrderCostEntrySchema.safeParse({ ...base, amount: '-1.00' })
        .success,
    ).toBe(false);
    expect(
      createOrderCostEntrySchema.safeParse({
        ...base,
        category: OrderCostCategory.ADJUSTMENT,
        amount: '-1.00',
      }).success,
    ).toBe(true);
    expect(
      createOrderCostEntrySchema.safeParse({
        ...base,
        category: OrderCostCategory.ADJUSTMENT,
        amount: '1.00',
      }).success,
    ).toBe(true);
    expect(
      createOrderCostEntrySchema.safeParse({
        ...base,
        category: OrderCostCategory.ADJUSTMENT,
        amount: '0.00',
      }).success,
    ).toBe(false);
  });

  it('requires amount to equal quantity times unit price after cent rounding', () => {
    expect(
      createOrderCostEntrySchema.safeParse({
        ...base,
        quantity: '12.345',
        unitPrice: '1.2345',
        amount: '15.24',
      }).success,
    ).toBe(true);
    expect(
      createOrderCostEntrySchema.safeParse({
        ...base,
        quantity: '12.345',
        unitPrice: '1.2345',
        amount: '15.23',
      }).success,
    ).toBe(false);
    expect(
      createOrderCostEntrySchema.safeParse({
        ...base,
        quantity: '1',
        unitPrice: '0.005',
        amount: '0.01',
      }).success,
    ).toBe(true);
  });
});

describe('recordCsPayrollPaymentSchema', () => {
  const base = {
    idempotencyKey: '00000000-0000-4000-8000-000000000003',
    paidAt: '2026-05-01T10:30',
    paymentMethod: null,
    referenceNo: null,
    remark: null,
  };

  it('accepts separate bottom-salary and commission amounts', () => {
    const result = recordCsPayrollPaymentSchema.safeParse({
      ...base,
      baseAmount: '2000.00',
      commissionAmount: '33000.00',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.paidAt.toISOString()).toBe(
        '2026-05-01T02:30:00.000Z',
      );
    }
  });

  it('rejects zero total, negative values, overflow, and invalid request keys', () => {
    for (const input of [
      { ...base, baseAmount: '', commissionAmount: '' },
      { ...base, baseAmount: '-1', commissionAmount: '0' },
      { ...base, baseAmount: '10000000000.00', commissionAmount: '0' },
      {
        ...base,
        idempotencyKey: 'not-a-uuid',
        baseAmount: '1',
        commissionAmount: '0',
      },
    ]) {
      expect(recordCsPayrollPaymentSchema.safeParse(input).success).toBe(false);
    }
  });

  it('rejects impossible Shanghai calendar dates instead of rolling them forward', () => {
    for (const paidAt of [
      '2026-02-31T10:30',
      '2026-04-31T10:30',
      '2026-05-01T24:00',
      '2026-05-01T10:60',
    ]) {
      expect(
        recordCsPayrollPaymentSchema.safeParse({
          ...base,
          paidAt,
          baseAmount: '1.00',
          commissionAmount: '0',
        }).success,
        paidAt,
      ).toBe(false);
    }
  });
});

describe('recordBillPaymentSchema', () => {
  const base = {
    idempotencyKey: '00000000-0000-4000-8000-000000000004',
    amount: '1.00',
    paymentMethod: null,
    referenceNo: null,
    remark: null,
  };

  it('parses a valid datetime-local value as Shanghai wall time', () => {
    const result = recordBillPaymentSchema.safeParse({
      ...base,
      paidAt: '2026-05-01T10:30',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.paidAt.toISOString()).toBe(
        '2026-05-01T02:30:00.000Z',
      );
    }
  });

  it('rejects an impossible Shanghai collection date', () => {
    expect(
      recordBillPaymentSchema.safeParse({
        ...base,
        paidAt: '2026-02-31T10:30',
      }).success,
    ).toBe(false);
  });
});

describe('createReworkOrderSchema', () => {
  const input = {
    sourceOrderId: 'source-1',
    cause: 'QUALITY',
    reason: '烫金位置偏移',
    items: [
      {
        sourceOrderItemId: 'item-1',
        quantity: 100,
        craftIds: ['craft-1'],
      },
    ],
  };

  it('rejects duplicate crafts for the same rework item', () => {
    const result = createReworkOrderSchema.safeParse({
      ...input,
      items: [{ ...input.items[0], craftIds: ['craft-1', 'craft-1'] }],
    });
    expect(result.success).toBe(false);
  });

  it('allows packing-only rework and normalizes an explicit legacy pack value', () => {
    const result = createReworkOrderSchema.safeParse({
      ...input,
      cause: 'LOGISTICS_DAMAGE',
      items: [
        {
          ...input.items[0],
          craftIds: [],
          unitsPerBag: '50',
        },
      ],
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.items[0]).toMatchObject({
      craftIds: [],
      unitsPerBag: 50,
    });
  });

  it.each([0, -1, 1.5, 10_000_000, 'abc'])(
    'rejects invalid explicit units per bag: %s',
    (unitsPerBag) => {
      const result = createReworkOrderSchema.safeParse({
        ...input,
        items: [{ ...input.items[0], unitsPerBag }],
      });
      expect(result.success).toBe(false);
    },
  );
});
