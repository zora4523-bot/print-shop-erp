export type ReceiverInfoParts = {
  receiverName?: string | null;
  receiverPhone?: string | null;
  receiverAddress?: string | null;
};

export function formatReceiverInfo(
  info: ReceiverInfoParts,
  fallback = '—',
): string {
  const value = [
    info.receiverName?.trim(),
    info.receiverPhone?.trim(),
    info.receiverAddress?.trim(),
  ]
    .filter((part): part is string => Boolean(part))
    .join(' · ');

  return value || fallback;
}
