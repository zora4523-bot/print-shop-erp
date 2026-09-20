import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { assertActivatedE2eDatabase } from '../../scripts/lib/e2e-environment';
import type { readPaperSpecifications } from '../../lib/price/read-paper-specifications';
import type { listExternalCreateOrderOptions } from '../../lib/order/create-order-options';
import type { buildExternalOrderPapers } from '../../lib/order/order-item-catalog';

const exec = promisify(execFile);
export async function paperCommand<T>(command: Record<string, unknown>): Promise<T> {
  assertActivatedE2eDatabase();
  const { stdout } = await exec(process.execPath, ['--conditions=react-server', '--import', 'tsx',
    'tests/e2e/paper-spec-command.ts', JSON.stringify(command)], { env: process.env, maxBuffer: 8 * 1024 * 1024 }).catch((error: unknown) => {
      const output = (error as { stdout?: string }).stdout;
      if (output) throw new Error((JSON.parse(output) as { error: string }).error);
      throw error;
    });
  return (JSON.parse(stdout) as { result: T }).result;
}
export type PaperFixture = { paperId: string; productId: string; name: string; nodeId: string };
export type PaperState = {
  products: { id: string; code: string; name: string; isActive: boolean; paperMaterialId: string | null; updatedAt: string }[];
  audits: unknown[];
  priceDigest: string;
  view: Awaited<ReturnType<typeof readPaperSpecifications>>;
};
export type PaperCatalog = {
  options: Awaited<ReturnType<typeof listExternalCreateOrderOptions>>;
  papers: ReturnType<typeof buildExternalOrderPapers>;
};
