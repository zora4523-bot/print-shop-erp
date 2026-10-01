import { describe, expect, it } from 'vitest';
import { cdrClientProgress, cdrPollExpired, shouldAutoDownload } from '../client-progress';
import type { CdrHistoryRow } from '../history';
const now = '2026-10-02T00:00:00Z';
const queued = { status: 'queued', bundleId: 'b', jobId: 'j', fileCount: 1 } as const;
const ready: CdrHistoryRow = { id: 'b', status: 'READY', isMock: false, downloadUrl: '/download',
  expiresAt: '2026-10-03T00:00:00Z', revokedAt: null, createdAt: now, createdByName: '管理',
  orderCount: 1, fileCount: 1, downloadCount: 0, failureMessage: null };
describe('CDR client progress', () => {
  it('uses the requested poll outside recent history and ignores another bundle', () => {
    expect(cdrClientProgress(queued, [], ready, now).url).toBe('/download');
    expect(cdrClientProgress(queued, [], { ...ready, id: 'other' }, now).url).toBe('');
    expect(cdrClientProgress(queued, [{ ...ready, status: 'PENDING' }], ready, now).url).toBe('/download');
  });
  it.each([{ isMock: true }, { revokedAt: now }, { expiresAt: now }, { status: 'FAILED' }])('refuses non-downloadable state %j', (patch) => {
    expect(cdrClientProgress(queued, [{ ...ready, ...patch }], ready, now).url).toBe('');
  });
  it('does not fall back to an action URL over a revoked server record', () => {
    const success = { ...queued, status: 'success', isMock: false, downloadUrl: '/action', relativePath: '/action', expiresAt: ready.expiresAt } as const;
    expect(cdrClientProgress(success, [], null, now).url).toBe('/action');
    expect(cdrClientProgress(success, [{ ...ready, revokedAt: now }], null, now).url).toBe('');
    expect(cdrClientProgress({ ...success, expiresAt: now }, [], null, now).url).toBe('');
  });
  it('attempts once per bundle and permits a new bundle', () => {
    expect(shouldAutoDownload('/download', 'b', null)).toBe(true);
    expect(shouldAutoDownload('/download', 'b', 'b')).toBe(false);
    expect(shouldAutoDownload('/download', 'c', 'b')).toBe(true);
    expect(shouldAutoDownload('', 'b', null)).toBe(false);
  });
  it('stops at 120 seconds and a renewed window resumes', () => {
    expect(cdrPollExpired(0, 119999)).toBe(false);
    expect(cdrPollExpired(0, 120000)).toBe(true);
    expect(cdrPollExpired(120000, 120001)).toBe(false);
  });
});
