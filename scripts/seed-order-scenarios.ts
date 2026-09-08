import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import Decimal from 'decimal.js';
import { db } from '@/lib/db';
import { createOrder, getOrderDetail } from '@/lib/order';
import { OrderStatus } from '@/generated/prisma/enums';
import { createOrderChangeRequest } from '@/lib/order/change-request';
import { orderCascadeLockKey } from '@/lib/order/locks';
import { transitionOrder } from '@/lib/order/status-machine';
import { ExternalOrderQuoteChangedError, finalizeExternalOrderQuoteInTx } from '@/lib/order/submit-external-order';
import { prepareOrderForProductionInTx } from '@/lib/order/production-readiness';
import { getAdminOrderByOrderNo } from '@/lib/order/admin-workspace';
import { adminOrderCraftTags } from '@/lib/order/admin-list-presentation';
import { assertLocalFixtureDatabase } from './lib/dashboard-order-completion';
import { ORDER_SCENARIOS, buildOrderScenarioInput, type ScenarioCatalog } from './lib/order-scenario-fixtures';

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--apply' && !arg.startsWith('--report='))) throw new Error('用法：默认只预览；写入需 --apply --report=<仓库外绝对路径>');
  assertLocalFixtureDatabase(process.env.DATABASE_URL ?? '', process.env.NODE_ENV);
  const apply = args.includes('--apply');
  const report = args.find((arg) => arg.startsWith('--report='))?.slice(9);
  if (apply && (!report || !path.isAbsolute(report) || !path.relative(process.cwd(), report).startsWith(`..${path.sep}`))) throw new Error('需要仓库外的报告路径');
  const [sales, admin, products, crafts] = await Promise.all([
    db.user.findUnique({ where: { username: 'e2e-sales' } }), db.user.findUnique({ where: { username: 'e2e-owner' } }),
    db.product.findMany({ where: { isActive: true } }), db.craft.findMany({ where: { isActive: true } }),
  ]);
  if (!sales || sales.role !== 'SALES' || !sales.isActive || !admin || admin.role !== 'ADMIN' || !admin.isActive) throw new Error('缺少活跃的 e2e-sales / e2e-owner 测试账号');
  const product = (code: string) => { const row = products.find((p) => p.code === code); if (!row) throw new Error(`缺少目录产品 ${code}`); return row.id; };
  const craft = (code: string) => { const row = crafts.find((p) => p.code === code); if (!row) throw new Error(`缺少工艺 ${code}`); return row.id; };
  const catalog: ScenarioCatalog = {
    products: { PARTIAL: product('EXT-STOCK-PEARL-FLASH-160-LARGE'), FULL: product('EXT-CUSTOM-LARGE'), PRINT: product('EXT-COLOR-COATED-200-LARGE') },
    crafts: { PARTIAL: craft('FLAT_FOIL_PARTIAL'), FULL: craft('FLAT_FOIL_SINGLE'), PRINT: craft('COATED_COLOR_PRINT'), PRINT_FOIL: craft('COATED_COLOR_PRINT_FOIL'), MANUAL: craft('FLAT_FOIL_TRIPLE') },
  };
  const now = new Date();
  const plans = ORDER_SCENARIOS.map((scenario) => ({ scenario, input: buildOrderScenarioInput(scenario, catalog, now) }));
  if (!apply) { console.log(JSON.stringify(plans.map(({ scenario, input }) => ({ scenario: scenario.key, name: input.customName, crafts: scenario.crafts, date: input.promisedDate, shipments: 1 + input.additionalShipments.length })), null, 2)); return; }
  // This manifest is created before any writes. Existing keys are never updated.
  const results: unknown[] = [];
  await writeFile(report!, JSON.stringify({ source: 'ORDER_SCENARIO_V1', results }), { flag: 'wx', mode: 0o600 });
  for (const { scenario, input } of plans) {
    const existing = await db.order.findUnique({ where: { clientSubmissionId: input.clientSubmissionId }, include: { items: { orderBy: { sequence: 'asc' }, include: { designs: true } }, _count: { select: { logs: true } } } });
    if (existing) {
      if (existing.submitterId !== sales.id || !existing.remark?.startsWith('ORDER_SCENARIO_V1')) throw new Error('场景提交标识与现有数据冲突');
      if (!(existing.status === 'DRAFT' && existing.editVersion === 0 && existing.priceRevision === 0 && existing._count.logs === 1 && existing.items.every((item) => item.designs.length === 0))) {
        results.push({ scenario: scenario.key, id: existing.id, result: 'SKIPPED_EXISTING' });
        continue;
      }
    }
    const created = existing ? { id: existing.id, orderNo: existing.orderNo, itemIds: existing.items.map((item) => item.id) } : await createOrder(input, { id: sales.id, role: sales.role }, now);
    results.push({ scenario: scenario.key, id: created.id, result: 'DRAFT_CREATED' });
    await writeFile(report!, JSON.stringify({ source: 'ORDER_SCENARIO_V1', results }, null, 2));
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(created.id)}))`;
      const order = await tx.order.findUniqueOrThrow({ where: { id: created.id }, include: { items: { include: { designs: true } }, _count: { select: { logs: true } } } });
      if (order.status !== 'DRAFT' || order.editVersion !== 0 || order.priceRevision !== 0 || order._count.logs !== 1 || order.items.some((item) => item.designs.length > 0)) throw new Error('新场景草稿已被修改');
      for (const [index, itemId] of created.itemIds.entries()) {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="660"><rect width="360" height="660" fill="#9c2034"/><text x="180" y="300" text-anchor="middle" fill="#ffeac0" font-size="28">测试样稿 ${index + 1}</text><text x="180" y="370" text-anchor="middle" fill="#ffeac0" font-size="20">不可生产</text></svg>`;
        const url = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
        await tx.orderItemDesign.create({ data: { orderItemId: itemId, fileType: 'IMAGE', fileUrl: url, thumbnailUrl: url, fileName: `测试样稿-${index + 1}.svg`, fileSize: BigInt(Buffer.byteLength(svg)), uploadedBy: admin.id } });
      }
      const state = 'state' in scenario ? scenario.state : null;
      if (state !== 'DRAFT') {
        let token: string | undefined;
        try { await finalizeExternalOrderQuoteInTx(tx, order.id, sales.id, now); }
        catch (error) { if (!(error instanceof ExternalOrderQuoteChangedError)) throw error; token = error.quoteToken; }
        if (!token) throw new Error('新草稿未产生报价版本');
        const quote = await finalizeExternalOrderQuoteInTx(tx, order.id, sales.id, now, token);
        const manual = 'manual' in scenario && scenario.manual;
        if (manual ? quote.manualItemIds.length === 0 : quote.quotedFeeCompleteness !== 'COMPLETE') throw new Error(`${scenario.key}: 报价完整性与场景不符`);
        await tx.order.update({ where: { id: order.id }, data: { status: transitionOrder(order.status, OrderStatus.PENDING_FACTORY), submittedAt: now } });
        if (state === 'REJECTED') {
          await tx.order.update({ where: { id: order.id }, data: { status: transitionOrder(OrderStatus.PENDING_FACTORY, OrderStatus.REJECTED) } });
          await tx.orderWorkflowDecision.create({ data: { orderId: order.id, fromStatus: 'PENDING_FACTORY', toStatus: 'REJECTED', action: 'REJECT', reasonCode: 'PRICE_PENDING', reasonNote: '测试场景：三色专版需补核价信息', actorId: admin.id, idempotencyKey: `scenario:${scenario.key}:${order.id}` } });
        } else {
          const ready = await prepareOrderForProductionInTx(tx, order.id, admin, now);
          if (!manual && !ready.ready) throw new Error(`${scenario.key}: ${ready.issues.join('；')}`);
          if (state === 'ON_HOLD' || state === 'CANCELLED') {
            await tx.order.update({ where: { id: order.id }, data: { status: transitionOrder(ready.status, state) } });
            if (state === 'ON_HOLD') await tx.orderWorkflowDecision.create({ data: { orderId: order.id, fromStatus: ready.status, toStatus: 'ON_HOLD', action: 'HOLD', reasonCode: 'DESIGN_ERROR', reasonNote: '测试场景：暂停等待补稿', actorId: admin.id, idempotencyKey: `scenario:${scenario.key}:${order.id}` } });
          }
        }
      }
      if ('change' in scenario && scenario.change) {
        const current = await tx.order.findUniqueOrThrow({ where: { id: order.id } });
        await createOrderChangeRequest({ orderId: order.id, expectedRevision: current.revision, expectedWorkOrderVersion: current.workOrderVersion,
          type: 'MODIFY', modifyKind: 'QTY', reason: '测试场景：客户申请数量 1000 改为 1500，等待审批',
          items: [{ operation: 'UPDATE', itemId: created.itemIds[0]!, quantity: 1500 }] }, { id: sales.id, role: sales.role }, { tx });
      }
      await tx.orderLog.create({ data: { orderId: order.id, operatorId: admin.id, action: 'UPDATE', remark: `ORDER_SCENARIO_V1：${scenario.name}；仅本地验收，未发送通知，未下发生产`, changedFields: { source: 'ORDER_SCENARIO_V1', scenario: scenario.key } } });
    }, { timeout: 60000 });
    const detail = await getOrderDetail(created.id, { id: admin.id, role: admin.role });
    const list = await getAdminOrderByOrderNo({ id: admin.id, role: admin.role }, created.orderNo, now);
    if (!detail || !list || detail.items.length !== list.itemCount || list.totalQuantity !== input.items.reduce((sum, item) => sum + item.quantity, 0) ||
      JSON.stringify(list.craftTags) !== JSON.stringify(adminOrderCraftTags(detail.items.map((item) => item.craft))) ||
      JSON.stringify(list.craftTags) !== JSON.stringify(adminOrderCraftTags(scenario.crafts.map((craft) => craft === 'PRINT_FOIL' ? 'PRINT' : craft)))) throw new Error('列表、详情、编辑共用读取数据不一致');
    if ('change' in scenario && scenario.change && (!list.pendingChangeRequest || list.capabilities.release || list.totalQuantity !== 1000)) throw new Error('待审批申请提前生效或没有阻止下发');
    const saved = await db.order.findUniqueOrThrow({ where: { id: created.id }, include: { items: { include: { shipmentLines: true } }, packagingGroups: { include: { lines: true } }, customerCharges: { include: { category: true } }, quotedPricingRevision: true } });
    if (saved.items.some((item) => item.shipmentLines.reduce((sum, line) => sum + line.quantity, 0) !== item.quantity)) throw new Error('配送分货数量不一致');
    for (const item of saved.items) {
      const packed = saved.packagingGroups.reduce((sum, group) => sum + group.actualBagCount * group.lines.filter((line) => line.orderItemId === item.id).reduce((units, line) => units + line.unitsPerBag, 0), 0);
      if (packed !== item.quantity) throw new Error('包装明细数量不一致');
    }
    if (saved.customerCharges.some((charge) => charge.category.code === 'PLATE_MAKING_FEE' && charge.amount && !charge.amount.isZero())) throw new Error('默认版费不是零');
    if (saved.status !== 'DRAFT') {
      const bags = saved.packagingGroups.reduce((sum, group) => sum.plus(group.subtotal), new Decimal(0));
      const processing = saved.items.reduce((sum, item) => sum.plus(item.subtotal), bags);
      const total = saved.customerCharges.reduce((sum, charge) => sum.plus(charge.amount ?? 0), processing);
      if (!bags.equals(saved.packagingAmount) || !processing.equals(saved.processingAmount) || !total.equals(saved.totalAmount) || saved.quotedPricingRevision?.orderId !== saved.id || saved.items.some((item) => !item.pricingSnapshot)) throw new Error('关联费用与报价快照不一致');
    }
    results[results.length - 1] = { scenario: scenario.key, id: created.id, name: input.customName, status: saved.status, crafts: list.craftTags, amount: list.fee.amount, result: 'VERIFIED' };
    await writeFile(report!, JSON.stringify({ source: 'ORDER_SCENARIO_V1', results }, null, 2));
  }
  await writeFile(report!, JSON.stringify({ source: 'ORDER_SCENARIO_V1', results }, null, 2));
  console.log(JSON.stringify(results, null, 2));
}
main().catch((error: unknown) => { console.error(error instanceof Error && !error.name.startsWith('Prisma') ? error.message : '数据库操作失败；请检查报告中的已创建草稿'); process.exitCode = 1; }).finally(() => db.$disconnect());
