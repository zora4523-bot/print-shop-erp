export function orderNoFromHash(hash: string): string | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const params = new URLSearchParams(raw);
  const orderNo = params.get('wo')?.trim() ?? '';
  if (!orderNo || orderNo.length > 128) return null;
  return orderNo;
}
