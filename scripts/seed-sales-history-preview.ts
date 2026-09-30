import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadEnvConfig } from '@next/env';
import { activateE2eDatabase } from './lib/e2e-environment';
import { parseSalesHistoryPreview } from './lib/sales-history-preview';

// Explicit input file, confirmed disposable database, test principals, append-only transaction.
async function main() {
  loadEnvConfig(process.cwd());
  const database = activateE2eDatabase();
  if (!database.target.startsWith('localhost:')) throw new Error('History preview requires a local test database');
  const path = process.argv[2];
  if (!path) throw new Error('Pass the verified source JSON path');
  const source = await readFile(path, 'utf8');
  const rows = parseSalesHistoryPreview(JSON.parse(source));
  const digest = createHash('sha256').update(source).digest('hex').slice(0, 12);
  const username = `history-dabiaoge-${digest}`;
  const { db } = await import('../lib/db');
  try {
    const account = await db.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { username }, select: { id: true } });
      if (existing) {
        if (await tx.order.count({ where: { submitterId: existing.id } }) !== rows.length) throw new Error('Existing preview differs; use a fresh isolated database');
        return existing;
      }
      const admin = await tx.user.findUnique({ where: { username: 'e2e-owner' } });
      const template = await tx.user.findUnique({ where: { username: 'e2e-billing-sales' } });
      if (admin?.role !== 'ADMIN' || !admin.isActive || template?.role !== 'SALES') throw new Error('Prepare E2E users first');
      const user = await tx.user.create({ data: { username, password: template.password, displayName: '大表哥（历史回放测试）', role: 'SALES' } });
      const crafts = await tx.craft.findMany({ select: { id: true, name: true } });
      for (const row of rows) {
        const id = `history-${digest}-${row.id}`;
        const at = new Date(`${row.date}T12:00:00+08:00`);
        const confirmed = row.balanced;
        const craft = crafts.find((entry) => entry.name === row.process);
        const charges = [
          { categoryId: 'ccc_packing_material', description: '纸箱', amount: row.parts[3] },
          { categoryId: 'ccc_shipping_fee', description: '快递', amount: row.parts[4] },
          { categoryId: 'ccc_plate_making_fee', description: '版费', amount: row.parts[5] },
        ].filter((charge) => charge.amount !== null);
        await tx.order.create({ data: {
          id, orderNo: `HIST-${digest.slice(0, 4)}-${row.id}`, submitterId: user.id, submitterRole: 'SALES', createdById: admin.id,
          settlementType: 'EXTERNAL_SALES', billingMode: 'CHARGE', status: confirmed ? 'SETTLED' : 'DRAFT',
          customName: row.name, customerRef: `历史回放测试 ${row.id}`, packageRequirement: row.pack,
          remark: `历史回放测试；来源：${row.file} ${row.sheet} 第 ${row.row} 行。原日期 ${row.date}。测试发货、结算日期借用原日期，不代表实际履约。原款数：${row.styles ?? '未填'}。原数量：${row.quantityRaw ?? '未填'}，总数：${row.g ?? '未填'}，总计：${row.h ?? '未填'}。${row.conflictingTotals ? '原总数量不一致，待核对。' : ''}${row.amount === null ? '原总费用未填。' : row.balanced ? '' : `原总费用 ${row.amount}，分项差额 ${row.difference}，待核对。`}`,
          processingAmount: row.processing, packagingAmount: row.parts[2] ?? '0', totalAmount: row.amount ?? '0',
          confirmedFee: confirmed ? row.amount : null, settledFee: confirmed ? row.amount : null,
          settledAt: confirmed ? at : null, shippedAt: confirmed ? at : null, completedAt: confirmed ? at : null,
          settlementContractVersion: confirmed ? 2 : null,
          pricingStatus: confirmed ? 'ADMIN_CONFIRMED' : 'PENDING_ADMIN_CONFIRMATION',
          pricingConfirmedAt: confirmed ? at : null, pricingConfirmedById: confirmed ? admin.id : null,
          createdAt: at, updatedAt: at,
          items: row.quantity ? { create: [{ id: `${id}-item`, sequence: 1, name: row.name ?? '历史工单', quantity: row.quantity,
            paperType: row.paper, specification: row.size, crafts: craft ? [craft.id] : [], pricingRoute: 'MANUAL_QUOTE',
            productStructure: 'UNSPECIFIED', foilTechnique: 'UNSPECIFIED', subtotal: row.processing,
            remark: `原表款数 ${row.styles ?? '未填'}；测试按整行展示，未推断分款数量`,
          }] } : undefined,
          customerCharges: { create: charges.map((charge, index) => ({ ...charge, businessKey: `HISTORY:${index}`,
            status: confirmed ? 'FINAL' : 'ESTIMATED', createdById: admin.id,
            finalizedById: confirmed ? admin.id : null, finalizedAt: confirmed ? at : null,
          })) },
        } });
      }
      return user;
    }, { timeout: 120_000 });
    console.log(JSON.stringify({ database: database.target, username, accountId: account.id, sourceHash: digest,
      orders: rows.length, simulatedSettled: rows.filter((row) => row.balanced).length,
      missingAmount: rows.filter((row) => row.amount === null).length,
      inconsistentAmount: rows.filter((row) => row.amount !== null && !row.balanced).length }));
    if (process.argv.includes('--generate-bills')) {
      const { generateAgentMonthlyBillsForPeriod } = await import('../lib/agent-monthly-billing/generation');
      const admin = await db.user.findUniqueOrThrow({ where: { username: 'e2e-owner' } });
      const currentMonth = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit' }).format(new Date());
      for (const period of [...new Set(rows.filter((row) => row.balanced).map((row) => row.date.slice(0, 7)))].sort()) {
        if (period >= currentMonth) continue;
        const result = await generateAgentMonthlyBillsForPeriod(period, { id: admin.id, role: admin.role });
        if (result.errors.length) throw new Error(`Preview billing failed in ${period}`);
      }
      console.log('Generated closed-month draft bills in the isolated database; no receipts recorded.');
    }
  } finally {
    await db.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "History preview failed");
  process.exitCode = 1;
});
