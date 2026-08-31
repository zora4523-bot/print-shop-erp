import 'dotenv/config';

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  PieceworkPriceBookV1Manifest,
  PieceworkPublicationPreview,
  PieceworkPublicationReceipt,
  PublishPieceworkPriceBookV1Input,
} from '../lib/salary/piecework-price-book-admin';
import type { AuditActor } from '../lib/audit-log';

export type PieceworkPublisherCliOptions = {
  apply: boolean;
  manifestPath: string;
  actorUsername: string | null;
  expectedDraftUpdatedAt: Date | null;
};

export type PieceworkPublisherDependencies = {
  readManifest(path: string): Promise<{ rawText: string; value: unknown }>;
  parseManifest(value: unknown): PieceworkPriceBookV1Manifest;
  preview(
    manifest: PieceworkPriceBookV1Manifest,
    sourceSha256: string,
  ): Promise<PieceworkPublicationPreview>;
  resolveActor(username: string): Promise<AuditActor | null>;
  publish(
    input: PublishPieceworkPriceBookV1Input,
  ): Promise<PieceworkPublicationReceipt>;
  writeOutput(value: string): void;
};

const DEFAULT_MANIFEST = 'config/piecework-price-books/v1.json';

function optionValue(argument: string, name: string): string | null {
  const prefix = `${name}=`;
  return argument.startsWith(prefix) ? argument.slice(prefix.length) : null;
}

export function parsePieceworkPublisherCliOptions(
  args: string[],
): PieceworkPublisherCliOptions {
  let apply = false;
  let manifestPath = DEFAULT_MANIFEST;
  let actorUsername: string | null = null;
  let expectedDraftUpdatedAt: Date | null = null;

  for (const argument of args) {
    if (argument === '--apply') {
      apply = true;
      continue;
    }
    const manifest = optionValue(argument, '--manifest');
    if (manifest !== null) {
      if (!manifest.trim()) throw new Error('--manifest 不能为空');
      manifestPath = manifest;
      continue;
    }
    const actor = optionValue(argument, '--actor');
    if (actor !== null) {
      if (!actor.trim()) throw new Error('--actor 不能为空');
      actorUsername = actor.trim();
      continue;
    }
    const expected = optionValue(argument, '--expected-draft-updated-at');
    if (expected !== null) {
      const parsed = new Date(expected);
      if (!Number.isFinite(parsed.getTime())) {
        throw new Error('--expected-draft-updated-at 必须是有效 ISO 时间');
      }
      expectedDraftUpdatedAt = parsed;
      continue;
    }
    throw new Error(`未知参数：${argument}`);
  }

  return { apply, manifestPath, actorUsername, expectedDraftUpdatedAt };
}

export async function runPieceworkPriceBookV1Publisher(
  options: PieceworkPublisherCliOptions,
  dependencies: PieceworkPublisherDependencies,
): Promise<PieceworkPublicationPreview | PieceworkPublicationReceipt> {
  const source = await dependencies.readManifest(resolve(options.manifestPath));
  const sourceSha256 = createHash('sha256')
    .update(source.rawText)
    .digest('hex');
  const manifest = dependencies.parseManifest(source.value);

  // 不带 --apply 永远只读，即使 manifest 已经补齐也不写库。
  if (!options.apply) {
    const preview = await dependencies.preview(manifest, sourceSha256);
    dependencies.writeOutput(
      JSON.stringify({ mode: 'DRY_RUN', ...preview }, null, 2),
    );
    return preview;
  }

  if (!options.actorUsername) {
    throw new Error('--apply 必须同时提供 --actor=<活跃管理员用户名>');
  }
  if (!options.expectedDraftUpdatedAt) {
    throw new Error(
      '--apply 必须带上 dry-run 输出的 --expected-draft-updated-at=<ISO>',
    );
  }
  const actor = await dependencies.resolveActor(options.actorUsername);
  if (!actor) throw new Error('找不到对应的活跃管理员');

  const receipt = await dependencies.publish({
    manifest,
    actor,
    expectedDraftUpdatedAt: options.expectedDraftUpdatedAt,
    sourceSha256,
  });
  dependencies.writeOutput(
    JSON.stringify({ mode: 'APPLY', ...receipt }, null, 2),
  );
  return receipt;
}

async function main(): Promise<void> {
  const options = parsePieceworkPublisherCliOptions(process.argv.slice(2));
  const [{ db }, admin] = await Promise.all([
    import('../lib/db'),
    import('../lib/salary/piecework-price-book-admin'),
  ]);
  await runPieceworkPriceBookV1Publisher(options, {
    async readManifest(path) {
      const rawText = await readFile(path, 'utf8');
      return { rawText, value: JSON.parse(rawText) as unknown };
    },
    parseManifest: admin.parsePieceworkPriceBookV1Manifest,
    preview: admin.previewPieceworkPriceBookV1Publication,
    async resolveActor(username) {
      const actor = await db.user.findUnique({
        where: { username },
        select: {
          id: true,
          role: true,
          username: true,
          displayName: true,
          isActive: true,
        },
      });
      if (!actor?.isActive || actor.role !== 'ADMIN') return null;
      return {
        id: actor.id,
        role: actor.role,
        username: String(actor.username),
        displayName: actor.displayName,
      };
    },
    publish: admin.publishPieceworkPriceBookV1,
    writeOutput: console.log,
  });
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isDirectExecution) {
  main().catch((error: unknown) => {
    console.error(
      '计件工价簿 v1 发布失败：',
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  });
}
