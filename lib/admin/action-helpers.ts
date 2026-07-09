import { revalidatePath } from 'next/cache';
import { Prisma } from '../../generated/prisma/client';

export type MutationResult =
  | { status: 'success'; message?: string }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; message: string };

export type InvalidMutationResult = Extract<
  MutationResult,
  { status: 'invalid' }
>;

export type ErrorMutationResult = Extract<MutationResult, { status: 'error' }>;

export type ValidationIssueLike = {
  path: readonly PropertyKey[];
  message: string;
};

export type UniqueViolationMapping = {
  field: string;
  targets: readonly string[];
  message: string;
};

export function collectFieldErrors(
  issues: readonly ValidationIssueLike[],
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of issues) {
    const head = issue.path[0];
    const key = head === undefined ? '_' : String(head);
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

export function invalidFromIssues(
  issues: readonly ValidationIssueLike[],
): InvalidMutationResult {
  return { status: 'invalid', fieldErrors: collectFieldErrors(issues) };
}

// Deep 变体：复合路径 ['items', 0, 'quantity'] 展平为 'items.0.quantity'，
// 让嵌套数组表单能定位到具体行。与 collectFieldErrors（只取 path[0]）
// 是两个语义家族——扁平表单用 shallow，含数组/嵌套对象的表单用 deep；
// 给 shallow 表单换 deep 无害，反向替换会破坏嵌套字段的错误定位。
export function collectFieldErrorsDeep(
  issues: readonly ValidationIssueLike[],
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of issues) {
    const key = issue.path.length ? issue.path.map(String).join('.') : '_';
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

export function invalidFromIssuesDeep(
  issues: readonly ValidationIssueLike[],
): InvalidMutationResult {
  return { status: 'invalid', fieldErrors: collectFieldErrorsDeep(issues) };
}

export function getFormString(
  formData: FormData,
  key: string,
): string | undefined {
  const value = formData.get(key);
  return typeof value === 'string' ? value : undefined;
}

export function getFormStringOr(
  formData: FormData,
  key: string,
  fallback: string,
): string {
  return getFormString(formData, key) ?? fallback;
}

export function normalizePrismaUniqueTargets(target: unknown): string[] {
  if (Array.isArray(target)) {
    return target.filter((v): v is string => typeof v === 'string');
  }
  return typeof target === 'string' ? [target] : [];
}

export function mapPrismaUniqueViolation(
  err: unknown,
  mappings: readonly UniqueViolationMapping[],
): InvalidMutationResult | null {
  if (
    !(err instanceof Prisma.PrismaClientKnownRequestError) ||
    err.code !== 'P2002'
  ) {
    return null;
  }

  const targets = normalizePrismaUniqueTargets(err.meta?.target);
  for (const mapping of mappings) {
    if (targets.some((target) => mapping.targets.includes(target))) {
      return {
        status: 'invalid',
        fieldErrors: { [mapping.field]: [mapping.message] },
      };
    }
  }
  return null;
}

export function mapInvariantError(
  err: unknown,
  InvariantError: abstract new (...args: never[]) => Error,
): ErrorMutationResult | null {
  if (err instanceof InvariantError) {
    return { status: 'error', message: err.message };
  }
  return null;
}

export function revalidatePaths(paths: readonly string[]): void {
  for (const path of paths) revalidatePath(path);
}
