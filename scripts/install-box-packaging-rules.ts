/** Deployment data step after the packaging migrations. Published histories are immutable. */
import 'dotenv/config';
import { db } from '../lib/db';
import { installConfirmedBoxPackagingRules } from './lib/box-packaging-install';

async function main() {
  const args = process.argv.slice(2);
  const actorId = args.find((arg) => arg.startsWith('--actor='))?.slice(8);
  const actor = actorId ? await db.user.findUnique({ where: { id: actorId } }) : null;
  if (!actor || actor.role !== 'ADMIN' || !actor.isActive)
    throw new Error('请用 --actor=指定启用的管理员账号 ID');
  const receipt = await installConfirmedBoxPackagingRules(
    { ...actor, username: String(actor.username) },
    { apply: args.includes('--apply') },
  );
  console.log(JSON.stringify(receipt));
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
