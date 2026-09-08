import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import Decimal from 'decimal.js';
import { db } from '@/lib/db';
import { orderCascadeLockKey } from '@/lib/order/locks';
import {
  DASHBOARD_ORDER_ID, assertLocalFixtureDatabase, completionInclude,
  completionSkipReason, completeDashboardOrderInTx,
} from './lib/dashboard-order-completion';

type Result = Awaited<ReturnType<typeof completeDashboardOrderInTx>>;
class PreviewRollback extends Error {
  constructor(readonly rows: Result[]) { super('预览完成，事务回滚'); }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => !['--apply', '--all'].includes(arg) && !/^--(id|backup|admin)=.+$/.test(arg))) {
    throw new Error('用法：--all 或 --id=<工单ID>；写入另加 --apply --admin=<测试管理员用户名> --backup=<仓库外绝对路径>');
  }
  const apply = args.includes('--apply');
  const id = args.find((arg) => arg.startsWith('--id='))?.slice(5);
  const backup = args.find((arg) => arg.startsWith('--backup='))?.slice(9);
  const admin = args.find((arg) => arg.startsWith('--admin='))?.slice(8) ?? 'e2e-owner';
  assertLocalFixtureDatabase(process.env.DATABASE_URL ?? '', process.env.NODE_ENV);
  if ((id && (!DASHBOARD_ORDER_ID.test(id) || args.includes('--all'))) ||
    (apply && !id && !args.includes('--all'))) throw new Error('写入必须明确指定测试工单范围');
  if (apply && (!backup || !path.isAbsolute(backup) || !path.relative(process.cwd(), backup).startsWith(`..${path.sep}`))) {
    throw new Error('写入前必须指定仓库外的绝对备份路径');
  }
  const candidates = (await db.order.findMany({
    where: id ? { id } : { id: { startsWith: 'e2e-dash-' } },
    include: completionInclude, orderBy: { id: 'asc' },
  })).filter((order) => DASHBOARD_ORDER_ID.test(order.id));
  const eligible = candidates.filter((order) => !completionSkipReason(order));
  const skipped = candidates.filter((order) => completionSkipReason(order)).map((order) => ({
    id: order.id, reason: completionSkipReason(order),
  }));
  let results: Result[] = [];
  if (eligible.length) {
    try {
      results = await db.$transaction(async (tx) => {
        const actor = await tx.user.findUnique({ where: { username: admin }, select: { id: true, role: true, isActive: true, username: true } });
        if (!actor || actor.role !== 'ADMIN' || !actor.isActive || !actor.username.startsWith('e2e-')) {
          throw new Error('补全操作需要活跃的测试管理员，不能使用真实业务账号');
        }
        // Acquire all order locks before the shared catalog locks used by pricing.
        for (const order of eligible) {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(order.id)}))`;
        }
        const before = await tx.order.findMany({ where: { id: { in: eligible.map((order) => order.id) } }, include: completionInclude, orderBy: { id: 'asc' } });
        for (const order of before) {
          const reason = completionSkipReason(order);
          if (reason) throw new Error(`${order.id} 已变化：${reason}`);
        }
        if (before.length !== eligible.length) throw new Error('测试工单集合发生变化');
        if (apply) {
          // wx prevents overwriting an earlier recovery record; no credentials are included.
          await writeFile(backup!, JSON.stringify({ version: 1, createdAt: new Date(), orders: before }, null, 2), { flag: 'wx', mode: 0o600 });
        }
        const rows: Result[] = [];
        const now = new Date();
        for (const order of before) rows.push(await completeDashboardOrderInTx(tx, order.id, actor.id, now));
        for (const original of before) {
          const order = await tx.order.findUniqueOrThrow({ where: { id: original.id }, include: {
            items: { include: { designs: true, shipmentLines: true, packagingGroupLines: { include: { packagingGroup: true } } } },
            shipments: true, packagingGroups: true, customerCharges: { include: { category: true } },
            quotedPricingRevision: { include: { priceVersionLocks: true } },
          } });
          for (const key of ['orderNo', 'status', 'submitterId', 'createdById', 'submitterRole', 'settlementType', 'isUrgent', 'revision', 'workOrderVersion'] as const) {
            if (order[key] !== original[key]) throw new Error(`工单原始 ${key} 被改变`);
          }
          for (const key of ['createdAt', 'submittedAt'] as const) {
            if (order[key]?.getTime() !== original[key]?.getTime()) throw new Error(`工单原始 ${key} 被改变`);
          }
          if (order.editVersion <= original.editVersion || order.confirmedFee !== null || order.settledFee !== null ||
            order.quotedFeeCompleteness !== 'COMPLETE' || order.quotedPricingRevision?.orderId !== order.id ||
            order.quotedPricingRevision.revision !== order.priceRevision ||
            new Set(order.quotedPricingRevision.priceVersionLocks.map((lock) => lock.purpose)).size !== 2) {
            throw new Error(`${order.id} 版本或价格快照不一致`);
          }
          for (const item of order.items) {
            if (item.quoteDisposition !== 'PRICED' || !item.pricingSnapshot || !item.quotedAmount?.equals(item.subtotal) ||
              item.shipmentLines.reduce((sum, line) => sum + line.quantity, 0) !== item.quantity ||
              item.packagingGroupLines.length !== 1 || !item.pack ||
              item.packagingGroupLines[0]?.unitsPerBag !== item.pack ||
              item.packagingGroupLines[0]?.packagingGroup.actualBagCount !== Math.ceil(item.quantity / item.pack) ||
              item.designs.length !== 1 || item.designs[0]?.fileType !== 'IMAGE') throw new Error('款式分货、包装或报价不一致');
          }
          const packaging = order.packagingGroups.reduce((sum, group) => sum.plus(group.subtotal.toString()), new Decimal(0));
          const processing = order.items.reduce((sum, item) => sum.plus(item.subtotal.toString()), packaging);
          const charges = order.customerCharges.reduce((sum, charge) => sum.plus(charge.amount?.toString() ?? 0), new Decimal(0));
          if (!packaging.equals(order.packagingAmount.toString()) || !processing.equals(order.processingAmount.toString()) ||
            !processing.plus(charges).equals(order.totalAmount.toString()) || !order.quotedFee?.equals(order.totalAmount) ||
            order.customerCharges.some((charge) => charge.category.code === 'PLATE_MAKING_FEE' && charge.amount && !charge.amount.isZero()) ||
            order.shipments.length !== 1 || order.shipments[0]?.status !== 'PLANNED') throw new Error('金额或配送状态不一致');
        }
        if (!apply) throw new PreviewRollback(rows);
        return rows;
      }, { timeout: 180_000, maxWait: 10_000 });
    } catch (error) {
      if (!(error instanceof PreviewRollback)) throw error;
      results = error.rows;
    }
  }
  console.log(JSON.stringify({ mode: apply ? 'APPLIED' : 'ROLLED_BACK_PREVIEW', completed: results.length, skipped, results }, null, 2));
}

main().catch((error: unknown) => {
  // Prisma driver errors can include connection details; emit domain errors only.
  console.error(error instanceof Error && !error.name.startsWith('Prisma') ? error.message : '数据库操作失败，事务已回滚');
  process.exitCode = 1;
}).finally(() => db.$disconnect());
