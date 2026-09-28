import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { db } from '../lib/db';
import { productionRecoverySchema, repairProductionMetadata, scanProductionRecovery } from '../lib/production/recovery';

// Default is read-only. Writes require an explicit reviewed manifest and actor.
async function main() {
  const args = process.argv.slice(2);
  for (const arg of args) if (!/^(--apply|--manifest=.+|--actor=.+|--confirm-database=.+)$/.test(arg)) throw new Error('未知参数；支持 --manifest=路径 --apply --actor=管理员 --confirm-database=数据库名');
  const value = (name: string) => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const manifest = value('manifest');
  const plan = manifest ? z.array(productionRecoverySchema).parse(JSON.parse(await readFile(manifest, 'utf8'))) : [];
  const target = new URL(process.env.DATABASE_URL ?? '');
  const database = decodeURIComponent(target.pathname.slice(1));
  if (!args.includes('--apply')) {
    console.log(JSON.stringify({ database, mode: 'dry-run', proposed: plan, inventory: await scanProductionRecovery() }, null, 2));
    return;
  }
  if (!manifest || !plan.length || !value('actor') || value('confirm-database') !== database) throw new Error('执行需提供已核对清单、管理员及准确数据库名；先 dry-run 并备份');
  const actor = await db.user.findUnique({ where: { username: value('actor')! }, select: { id: true, role: true, isActive: true } });
  if (!actor?.isActive || actor.role !== 'ADMIN') throw new Error('需要有效管理员账号');
  for (const row of plan) console.log(JSON.stringify(await repairProductionMetadata(row, actor)));
}
main().catch(error => { console.error(error instanceof Error && error.constructor === Error ? error.message : '恢复失败，未处理后续条目；核对服务日志后重新扫描'); process.exitCode = 1; }).finally(() => db.$disconnect());
