import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/** Bind an explicitly opted-in working tree capture to every quote dependency. */
export async function paperComparisonSourceDigest(root: string): Promise<string> {
  const hash = createHash('sha256');
  const add = async (relative: string): Promise<void> => {
    const bytes = await readFile(join(root, relative));
    hash.update(`${relative}\0${bytes.length}\0`).update(bytes).update('\0');
  };
  const walk = async (relative: string): Promise<void> => {
    const entries = await readdir(join(root, relative), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = `${relative}/${entry.name}`;
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) await add(path);
      else throw new Error('采集源码不得包含符号链接或特殊文件');
    }
  };
  for (const directory of ['lib', 'generated', 'prisma']) await walk(directory);
  for (const file of ['package.json', 'pnpm-lock.yaml', 'tsconfig.json']) await add(file);
  return hash.digest('hex');
}
