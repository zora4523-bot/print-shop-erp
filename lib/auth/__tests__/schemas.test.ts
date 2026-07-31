import { describe, it, expect, vi } from 'vitest';
import {
  MachineType,
  PartyType,
  Role,
  WorkerType,
} from '../../../generated/prisma/client';
import {
  loginSchema,
  changePasswordSchema,
  createUserSchema,
  updateUserSchema,
  resetUserPasswordSchema,
  createCraftSchema,
  updateCraftSchema,
  createProductSchema,
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
  updateProductSchema,
  createOrderSchema,
  createReworkOrderSchema,
  batchScheduleOrdersSchema,
  updateEditableOrderSchema,
  setOrderSfCollectSchema,
} from '../schemas';

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
        workerType: WorkerType.MACHINE,
        machineType: MachineType.HAND_PRESS,
        machineCapabilities: [MachineType.HAND_PRESS],
      });
      expect(r.success).toBe(true);
    });

    it('accepts multiple machine capabilities when they include the primary machine', () => {
      const r = createUserSchema.safeParse({
        ...validCreate,
        role: Role.WORKER,
        workerType: WorkerType.MACHINE,
        machineType: MachineType.HAND_PRESS,
        machineCapabilities: [
          MachineType.HAND_PRESS,
          MachineType.WINDMILL,
        ],
        craftCapabilities: ['craft-foil', 'craft-color-foil'],
      });
      expect(r.success).toBe(true);
    });

    it('rejects machine capabilities that omit the primary machine', () => {
      const r = createUserSchema.safeParse({
        ...validCreate,
        role: Role.WORKER,
        workerType: WorkerType.MACHINE,
        machineType: MachineType.HAND_PRESS,
        machineCapabilities: [MachineType.WINDMILL],
      });
      expect(r.success).toBe(false);
      if (!r.success) {
        expect(
          r.error.issues.find(
            (issue) => issue.path[0] === 'machineCapabilities',
          )?.message,
        ).toMatch(/包含主机型/);
      }
    });

    it('accepts WORKER + PACKER without machineType', () => {
      const r = createUserSchema.safeParse({
        ...validCreate,
        role: Role.WORKER,
        workerType: WorkerType.PACKER,
        machineType: null,
      });
      expect(r.success).toBe(true);
    });

    it('rejects machineType on non-MACHINE worker', () => {
      const r = createUserSchema.safeParse({
        ...validCreate,
        role: Role.WORKER,
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
  defaultWorkerType: WorkerType.MACHINE,
  defaultMachineType: MachineType.WINDMILL,
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

  describe('defaultMachineType', () => {
    it('accepts null / empty string (outsource with no machine)', () => {
      for (const v of ['', null, undefined]) {
        const r = createCraftSchema.safeParse({
          ...validCraft,
          isOutsource: 'true',
          defaultWorkerType: '',
          defaultMachineType: v,
        });
        expect(r.success).toBe(true);
        if (r.success) expect(r.data.defaultMachineType).toBeNull();
      }
    });
    it('accepts a MachineType value', () => {
      const r = createCraftSchema.safeParse({
        ...validCraft,
        defaultMachineType: MachineType.HAND_PRESS,
      });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.defaultMachineType).toBe(MachineType.HAND_PRESS);
    });
    it('rejects an unknown string', () => {
      const r = createCraftSchema.safeParse({
        ...validCraft,
        defaultMachineType: 'NOT_A_MACHINE',
      });
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

  it('reuses the code / name regex', () => {
    const r = updateCraftSchema.safeParse({ ...validUpdate, code: 'bad-code' });
    expect(r.success).toBe(false);
  });

  it('still requires the stable code when editing', () => {
    expect(updateCraftSchema.safeParse({ ...validUpdate, code: '' }).success).toBe(
      false,
    );
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
  baseUnitPrice: '0.12',
  minOrderQty: '1000',
};

describe('createProductSchema', () => {
  it('accepts a typical entry', () => {
    const r = createProductSchema.safeParse(validProduct);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.baseUnitPrice).toBe('0.12');
      expect(r.data.minOrderQty).toBe(1000);
      expect(r.data.specification).toBeNull();
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

  describe('baseUnitPrice', () => {
    it.each(['0', '1', '100', '0.1', '1.5', '0.0001', '12.3456', '999999', '999999.9999'])(
      'accepts %j',
      (v) => {
        const r = createProductSchema.safeParse({ ...validProduct, baseUnitPrice: v });
        expect(r.success, v).toBe(true);
      },
    );

    it.each(['1.23456', '-1', '.5', '1.', 'abc', '1,5'])('rejects format %j', (v) => {
      const r = createProductSchema.safeParse({ ...validProduct, baseUnitPrice: v });
      expect(r.success, v).toBe(false);
    });

    it('rejects values exceeding Decimal(10,4) precision (Codex round 21 / P1)', () => {
      for (const v of ['1000000', '9999999', '1000000.0', '1000000.0000']) {
        const r = createProductSchema.safeParse({ ...validProduct, baseUnitPrice: v });
        expect(r.success, v).toBe(false);
      }
    });

    it('empty string is normalized to null', () => {
      const r = createProductSchema.safeParse({ ...validProduct, baseUnitPrice: '' });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.baseUnitPrice).toBeNull();
    });
  });

  describe('minOrderQty', () => {
    it('empty / whitespace → undefined (the DB will store null)', () => {
      for (const v of ['', '   ']) {
        const r = createProductSchema.safeParse({ ...validProduct, minOrderQty: v });
        expect(r.success).toBe(true);
        if (r.success) expect(r.data.minOrderQty).toBeUndefined();
      }
    });
    it('accepts positive int string', () => {
      const r = createProductSchema.safeParse({ ...validProduct, minOrderQty: '500' });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.minOrderQty).toBe(500);
    });
    it('rejects 0 / negative / decimal', () => {
      for (const bad of ['0', '-1', '3.5', 'abc']) {
        const r = createProductSchema.safeParse({ ...validProduct, minOrderQty: bad });
        expect(r.success, bad).toBe(false);
      }
    });
    it('rejects JS-ish numeric forms that z.coerce would have accepted (Codex round 21 / P2)', () => {
      // Trimming is explicitly part of the preprocess, so ' 5 ' is fine —
      // the invalid shapes are the ones that break the digit-only regex.
      for (const bad of ['1e3', '0x10', '+5', '005e1']) {
        const r = createProductSchema.safeParse({ ...validProduct, minOrderQty: bad });
        expect(r.success, bad).toBe(false);
      }
    });
    it('accepts the boundary value 9,999,999 but not one more', () => {
      expect(
        createProductSchema.safeParse({ ...validProduct, minOrderQty: '9999999' }).success,
      ).toBe(true);
      expect(
        createProductSchema.safeParse({ ...validProduct, minOrderQty: '10000000' }).success,
      ).toBe(false);
    });
    it('also accepts a plain number for programmatic callers (Codex round 22 / P2)', () => {
      const r = createProductSchema.safeParse({ ...validProduct, minOrderQty: 500 });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.minOrderQty).toBe(500);
    });
    it('still rejects non-int and out-of-range numbers', () => {
      for (const bad of [3.5, 0, -1, 10_000_000]) {
        const r = createProductSchema.safeParse({ ...validProduct, minOrderQty: bad });
        expect(r.success, String(bad)).toBe(false);
      }
    });
    it('rejects Infinity / NaN on the numeric path (Codex round 23 / P2)', () => {
      for (const bad of [Infinity, -Infinity, NaN]) {
        const r = createProductSchema.safeParse({ ...validProduct, minOrderQty: bad });
        expect(r.success, String(bad)).toBe(false);
      }
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
      remark: '',
      items: [
        { materialId: 'mat_1', locationId: 'loc_a', countedQuantity: '0' },
      ],
    };
    expect(postInventoryCountSchema.safeParse(valid).success).toBe(true);
    expect(
      postInventoryCountSchema.safeParse({ ...valid, items: [] }).success,
    ).toBe(false);
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
    receiverAddress: null,
    expressCode: null,
    packageRequirement: null,
    remark: null,
    promisedDate: null,
    isUrgent: false,
    isSfCollect: false,
    items: [
      {
        name: '多色烫金款',
        productId: null,
        specification: '大号',
        paperType: '艳红珠光纸',
        quantity: 1000,
        crafts: ['craft-1'],
        foilColors: ['哑金', '红金', ' 古铜金 '],
        isDoubleSided: false,
        isDoubleColor: false,
        unitPrice: null,
        suggestedPrice: null,
        remark: null,
      },
    ],
  };

  it('accepts and trims up to five preset or custom colors', () => {
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

  it('defaults an omitted color array to empty for compatibility', () => {
    const item = { ...order.items[0] };
    delete (item as Partial<typeof item>).foilColors;
    const result = createOrderSchema.safeParse({ ...order, items: [item] });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.items[0]?.foilColors).toEqual([]);
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

    const omitted = updateEditableOrderSchema.parse({ remark: '保持其他字段' });
    expect('isSfCollect' in omitted).toBe(false);
    expect(setOrderSfCollectSchema.parse({ isSfCollect: 'false' })).toEqual({
      isSfCollect: false,
    });
    expect(
      setOrderSfCollectSchema.safeParse({}).success,
      '独立切换必须携带明确目标值',
    ).toBe(false);
  });

  it('rejects duplicate colors, more than five colors, and no-color mixtures', () => {
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
});

describe('batchScheduleOrdersSchema', () => {
  it('accepts unique order ids and one worker id', () => {
    expect(
      batchScheduleOrdersSchema.parse({
        orderIds: ['order-1', 'order-2'],
        workerId: 'worker-1',
      }),
    ).toEqual({
      orderIds: ['order-1', 'order-2'],
      workerId: 'worker-1',
    });
  });

  it('rejects empty, duplicate, oversized and unsafe order selections', () => {
    for (const orderIds of [
      [],
      ['order-1', 'order-1'],
      Array.from({ length: 31 }, (_, index) => `order-${index}`),
      ['../order-1'],
    ]) {
      expect(
        batchScheduleOrdersSchema.safeParse({
          orderIds,
          workerId: 'worker-1',
        }).success,
      ).toBe(false);
    }
  });
});
