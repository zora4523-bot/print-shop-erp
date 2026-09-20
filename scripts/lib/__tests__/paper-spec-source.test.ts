import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { paperComparisonSourceDigest } from '../paper-spec-source';

describe('working tree capture evidence', () => {
  it('binds the generated client and untracked quote dependencies as well as tracked source', async () => {
    const root = await mkdtemp(join(tmpdir(), 'paper-source-'));
    try {
      for (const directory of ['lib', 'generated', 'prisma']) await mkdir(join(root, directory));
      for (const file of ['package.json', 'pnpm-lock.yaml', 'tsconfig.json']) await writeFile(join(root, file), '{}');
      const before = await paperComparisonSourceDigest(root);
      await writeFile(join(root, 'generated', 'client.ts'), 'generated');
      expect(await paperComparisonSourceDigest(root)).not.toBe(before);
      const generated = await paperComparisonSourceDigest(root);
      await writeFile(join(root, 'lib', 'untracked.ts'), 'new quote dependency');
      expect(await paperComparisonSourceDigest(root)).not.toBe(generated);
      const same = await paperComparisonSourceDigest(root);
      expect(await paperComparisonSourceDigest(root)).toBe(same);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
