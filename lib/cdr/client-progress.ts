import type { CreateBundleResult } from '../../actions/foreman-cdr.types';
import type { CdrHistoryRow } from './history';

/** Pure display state; the download route independently checks expiry/revocation. */
export function cdrClientProgress(
  state: CreateBundleResult | null,
  bundles: CdrHistoryRow[],
  polled: CdrHistoryRow | null,
  now: string,
) {
  if (state?.status !== 'queued' && state?.status !== 'success') {
    return { bundleId: null, current: undefined, url: '' };
  }
  const recent = bundles.find((bundle) => bundle.id === state.bundleId);
  const matchingPoll = polled?.id === state.bundleId ? polled : undefined;
  const current = recent && recent.status !== 'PENDING' ? recent : matchingPoll ?? recent;
  let url = '';
  if (current) {
    if (current.status === 'READY' && !current.revokedAt && !current.isMock &&
      new Date(current.expiresAt).getTime() > new Date(now).getTime()) url = current.downloadUrl;
  } else if (state.status === 'success' && !state.isMock &&
    new Date(state.expiresAt).getTime() > new Date(now).getTime()) url = state.downloadUrl;
  return { bundleId: state.bundleId, current, url };
}

export function shouldAutoDownload(url: string, bundleId: string | null, attempted: string | null) {
  return !!url && !!bundleId && attempted !== bundleId;
}
export const CDR_POLL_INTERVAL_MS = 5_000;
const CDR_POLL_WINDOW_MS = 120_000;
export function cdrPollExpired(started: number, now: number) {
  return now - started >= CDR_POLL_WINDOW_MS;
}
