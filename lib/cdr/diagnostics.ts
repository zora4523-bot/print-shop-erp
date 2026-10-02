/** Diagnostics are allowlisted: SDK messages can contain signed URLs or credentials. */
const CODES = new Set(['AccessDenied', 'InvalidAccessKeyId', 'SignatureDoesNotMatch', 'SecurityTokenExpired',
  'NoSuchKey', 'NoSuchBucket', 'RequestTimeout', 'RequestTimeTooSkewed', 'ServiceUnavailable',
  'NetworkingError', 'TimeoutError', 'ArchiverError', 'ZlibError', 'ECONNRESET', 'ECONNREFUSED',
  'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ENOENT', 'ENOSPC', 'EACCES', 'EPIPE']);
export function cdrPackingDiagnostic(error: unknown) {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const code = [record.code, record.name].find(value => typeof value === 'string' && CODES.has(value));
  const messagePrefix = typeof record.message === 'string' ? record.message.split(/[:\s]/, 1)[0] : '';
  const cause = code ?? (CODES.has(messagePrefix) ? messagePrefix : 'UnknownPackingError');
  const status = typeof record.status === 'number' && Number.isInteger(record.status) && record.status >= 400 && record.status <= 599 ? record.status : undefined;
  return { code: 'CdrZipError', cause, ...(status ? { status } : {}) };
}
