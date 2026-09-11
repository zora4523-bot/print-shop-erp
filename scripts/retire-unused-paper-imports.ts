import { loadEnvConfig } from '@next/env';
import { Client } from 'pg';
import { retireUnusedPaperImports } from './maintenance/retire-unused-paper-imports';

async function main() {
  loadEnvConfig(process.cwd());
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--apply' && !arg.startsWith('--confirm-database='))) {
    throw new Error('仅支持 --apply 和 --confirm-database=<数据库名>；默认只演练并回滚');
  }
  const client = new Client({ connectionString: process.env.DATABASE_URL, options: '-c search_path=public' });
  try {
    if (!process.env.DATABASE_URL) throw new Error('缺少 DATABASE_URL');
    await client.connect();
    const result = await retireUnusedPaperImports(client, {
      apply: args.includes('--apply'),
      confirmDatabase: args.find((arg) => arg.startsWith('--confirm-database='))?.slice('--confirm-database='.length),
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    // Do not print pg connection strings, SQL parameters or secret-bearing detail.
    console.error(error instanceof Error ? error.message : '修复失败');
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

void main();
