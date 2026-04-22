import { describe, it, expect, vi } from 'vitest';
import { Role, WorkerType, MachineType } from '../../../generated/prisma/client';
import {
  loginSchema,
  changePasswordSchema,
  createUserSchema,
  updateUserSchema,
  resetUserPasswordSchema,
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
      });
      expect(r.success).toBe(true);
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
    isActive: true,
  };

  it('accepts a valid shape', () => {
    expect(updateUserSchema.safeParse(validUpdate).success).toBe(true);
  });

  it('requires isActive (boolean)', () => {
    const r = updateUserSchema.safeParse({ ...validUpdate, isActive: 'yes' });
    expect(r.success).toBe(false);
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
