import { db } from '../db';
import { decryptBundleDownloadUrl } from './access-token';
import { cdrBundleFailureDisplay } from './failure-display';
import type { RecentBundleRow } from './bundle';

export type CdrHistoryRow = {
  id: string; status: string; isMock: boolean; downloadUrl: string;
  expiresAt: string; revokedAt: string | null; createdAt: string;
  createdByName: string; orderCount: number; fileCount: number;
  downloadCount: number; failureMessage: string | null;
};
export function presentCdrHistory(row: Pick<RecentBundleRow, "id" | "status" | "zipFileUrl" | "downloadUrl" | "expiresAt" | "revokedAt" | "createdAt" | "createdByName" | "orderCount" | "fileCount" | "downloadCount" | "lastErrorCode">, now = new Date()): CdrHistoryRow {
  return {
    id: row.id, status: row.status, isMock: row.zipFileUrl.startsWith('mock://'),
    downloadUrl: row.status === 'READY' && !row.revokedAt && row.expiresAt > now && !row.zipFileUrl.startsWith('mock://') ? row.downloadUrl : '',
    expiresAt: row.expiresAt.toISOString(), revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(), createdByName: row.createdByName,
    orderCount: row.orderCount, fileCount: row.fileCount, downloadCount: row.downloadCount,
    failureMessage: row.status === 'FAILED' ? cdrBundleFailureDisplay(row.lastErrorCode).description : null,
  };
}

/** One requested bundle, regardless of its position in the recent-history window. */
export async function readCdrProgress(id: string): Promise<CdrHistoryRow | null> {
  const row = await db.designBundle.findUnique({ where: { id }, select: { id: true, status: true, zipFileUrl: true, downloadUrlCiphertext: true,
    expiresAt: true, revokedAt: true, createdAt: true, orderIds: true, designIds: true,
    downloadCount: true, lastErrorCode: true, createdBy: { select: { displayName: true } } } });
  if (!row) return null;
  return presentCdrHistory({ ...row, orderCount: row.orderIds.length, fileCount: row.designIds.length,
    createdByName: row.createdBy.displayName, downloadUrl: row.downloadUrlCiphertext && !row.revokedAt
      ? decryptBundleDownloadUrl(row.downloadUrlCiphertext) ?? '' : '',
  });
}
