export const DATABASE_BUSY_MESSAGE = '系统繁忙，请稍后重试';

export function isDatabaseBusyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error &&
    (error.code === 'P2024' || error.code === 'P2028');
}
