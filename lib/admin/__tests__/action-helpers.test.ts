import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '../../../generated/prisma/client';

const { revalidatePathMock } = vi.hoisted(() => ({
  revalidatePathMock: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));

import {
  collectFieldErrors,
  collectFieldErrorsDeep,
  invalidFromIssuesDeep,
  getFormString,
  getFormStringOr,
  invalidFromIssues,
  mapInvariantError,
  mapPrismaUniqueViolation,
  normalizePrismaUniqueTargets,
  revalidatePaths,
} from '../action-helpers';

beforeEach(() => {
  revalidatePathMock.mockReset();
});

describe('admin action helpers', () => {
  it('collects zod-like issues into field errors', () => {
    expect(
      collectFieldErrors([
        { path: ['name'], message: '请填写名称' },
        { path: ['name'], message: '名称过长' },
        { path: [], message: '整体错误' },
      ]),
    ).toEqual({
      name: ['请填写名称', '名称过长'],
      _: ['整体错误'],
    });
  });

  it('deep variant flattens compound paths so nested array forms can target rows', () => {
    expect(
      collectFieldErrorsDeep([
        { path: ['items', 0, 'quantity'], message: '数量必须为正整数' },
        { path: ['receiverName'], message: '请填写收货人' },
        { path: [], message: '整体错误' },
      ]),
    ).toEqual({
      'items.0.quantity': ['数量必须为正整数'],
      receiverName: ['请填写收货人'],
      _: ['整体错误'],
    });
    // 对照：shallow 版会把嵌套路径折叠到首段，丢失行定位。
    expect(
      collectFieldErrors([{ path: ['items', 0, 'quantity'], message: 'x' }]),
    ).toEqual({ items: ['x'] });
  });

  it('builds a deep invalid mutation result from validation issues', () => {
    expect(
      invalidFromIssuesDeep([{ path: ['items', 2, 'name'], message: '必填' }]),
    ).toEqual({
      status: 'invalid',
      fieldErrors: { 'items.2.name': ['必填'] },
    });
  });

  it('builds a standard invalid mutation result from validation issues', () => {
    expect(
      invalidFromIssues([{ path: ['code'], message: '代码重复' }]),
    ).toEqual({
      status: 'invalid',
      fieldErrors: { code: ['代码重复'] },
    });
  });

  it('reads only string values from FormData', () => {
    const fd = new FormData();
    fd.set('name', '红包');
    fd.set('file', new Blob(['x']), 'x.txt');

    expect(getFormString(fd, 'name')).toBe('红包');
    expect(getFormString(fd, 'file')).toBeUndefined();
    expect(getFormStringOr(fd, 'missing', '')).toBe('');
  });

  it('normalizes Prisma unique meta targets', () => {
    expect(normalizePrismaUniqueTargets(['code', 1, 'Material_code_key'])).toEqual([
      'code',
      'Material_code_key',
    ]);
    expect(normalizePrismaUniqueTargets('code')).toEqual(['code']);
    expect(normalizePrismaUniqueTargets(null)).toEqual([]);
  });

  it('maps P2002 unique violations into field errors', () => {
    const err = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: ['Material_code_key'] },
    });

    expect(
      mapPrismaUniqueViolation(err, [
        {
          field: 'code',
          targets: ['code', 'Material_code_key'],
          message: '该物料编码已被占用',
        },
      ]),
    ).toEqual({
      status: 'invalid',
      fieldErrors: { code: ['该物料编码已被占用'] },
    });
  });

  it('returns null for non-matching Prisma errors', () => {
    const err = new Prisma.PrismaClientKnownRequestError('missing', {
      code: 'P2025',
      clientVersion: 'test',
    });

    expect(
      mapPrismaUniqueViolation(err, [
        { field: 'code', targets: ['code'], message: '重复' },
      ]),
    ).toBeNull();
  });

  it('maps invariant errors into standard error results', () => {
    class InvariantError extends Error {}
    expect(mapInvariantError(new InvariantError('目标不存在'), InvariantError)).toEqual({
      status: 'error',
      message: '目标不存在',
    });
    expect(mapInvariantError(new Error('other'), InvariantError)).toBeNull();
  });

  it('revalidates every requested path', () => {
    revalidatePaths(['/owner/materials', '/owner/materials/m1']);
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/materials');
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/materials/m1');
  });
});
