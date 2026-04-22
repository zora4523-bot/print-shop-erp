import { describe, it, expect } from 'vitest';
import { loginSchema, changePasswordSchema } from '../schemas';

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

  it('rejects overly long new password', () => {
    const long = 'a'.repeat(257);
    const r = changePasswordSchema.safeParse({
      currentPassword: 'old-one-123',
      newPassword: long,
      confirmPassword: long,
    });
    expect(r.success).toBe(false);
  });
});
