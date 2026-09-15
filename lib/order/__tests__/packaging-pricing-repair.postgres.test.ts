import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { createOrder } from '@/lib/order';
import { createOrderSchema } from '@/lib/auth/schemas';
import {
  adminCreatePriceFactsKey,
  adminPackagingPriceFactsKey,
} from '../admin-create-price';
import { addOrderShipment } from '../add-shipment';
import {
  finalizeExternalOrderQuoteInTx,
  ExternalOrderQuoteChangedError,
} from '../submit-external-order';
import {
  isTrustedAdminItemPricingSnapshot,
  isTrustedAdminPackagingPricingSnapshot,
} from '../admin-pricing-snapshot';
import { deriveProductionOperationPlan } from '@/lib/production/operation-materializer';
import { activateProductionOperationsInTx } from '@/lib/production/operation-materialization-service';
import { reportProductionOperation } from '@/lib/production/operation-reporting';
import { publishPieceworkPriceBook } from '@/lib/salary/piecework-price-book-admin';
vi.mock('server-only', () => ({}));

// Explicit opt-in: this integration consumes the isolated packaging E2E fixtures.
const enabled = process.env.ERP_PRICING_REPAIR_DB_TEST === '1';
const integration = enabled ? describe : describe.skip;
integration.sequential('pricing repair · real PostgreSQL', () => {
  it('preserves manual prices, reprices split boxes, retains pending freight and reports PER_BOX wages', async () => {
    const name = new URL(process.env.DATABASE_URL!).pathname.slice(1);
    expect(name).toMatch(/(?:^|_)(?:test|e2e|ci)(?:_|$)/);
    expect(name).not.toMatch(/prod|live/);
    const owner = await db.user.findUniqueOrThrow({
      where: { username: 'e2e-owner' },
    });
    const sales = await db.user.findUniqueOrThrow({
      where: { username: 'e2e-sales' },
    });
    const baseline = await db.order.findFirstOrThrow({
      where: { customName: { startsWith: '包装验证 owner 触感盒' } },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    });
    const transaction = db.$transaction.bind(db);
    const rollback = new Error('ROLLBACK_PRICING_REPAIR_FIXTURES');
    try {
      await transaction(
        async (tx) => {
          const nested = vi
            .spyOn(db, '$transaction')
            .mockImplementation(((
              work: (client: typeof tx) => Promise<unknown>,
            ) => work(tx)) as never);
          try {
            function input(behalf: boolean, manual: boolean) {
              const item = baseline.items[0];
              const command = createOrderSchema.parse({
                ...baseline,
                clientSubmissionId: randomUUID(),
                customName: '人工价与装盒隔离回归',
                externalSalesUserId: behalf ? sales.id : null,
                additionalShipments: [],
                items: [
                  {
                    ...item,
                    fig: 1,
                    quantity: 101,
                    unitPrice: null,
                    fixedFee: null,
                    suggestedSubtotal: null,
                    actualWidthMm: item.actualWidthMm?.toNumber() ?? null,
                    actualHeightMm: item.actualHeightMm?.toNumber() ?? null,
                  },
                ],
                packagingGroups: [
                  {
                    name: null,
                    mode: 'BOX_TACTILE',
                    actualBagCount: 13,
                    itemUnitsPerBag: [8],
                  },
                ],
              });
              if (manual) {
                command.items[0].adminPrice = {
                  amount: '123.45',
                  reason: '协议加工价',
                  factsKey: adminCreatePriceFactsKey(command.items[0]),
                };
                command.packagingGroups[0].adminPrice = {
                  amount: '2.3',
                  reason: '协议装盒单价',
                  factsKey: adminPackagingPriceFactsKey(
                    command.packagingGroups[0],
                    [101],
                    [],
                  ),
                };
              }
              return command;
            }
            await expect(
              createOrder(input(false, true), {
                id: sales.id,
                role: sales.role,
              }),
            ).rejects.toThrow('只有管理员');
            const invalid = input(false, true);
            invalid.items[0].quantity = 102;
            await expect(createOrder(invalid, owner)).rejects.toThrow(
              '重新确认人工价格',
            );
            for (const behalf of [false, true]) {
              const created = await createOrder(input(behalf, true), owner);
              let order = await tx.order.findUniqueOrThrow({
                where: { id: created.id },
                include: {
                  items: true,
                  packagingGroups: { include: { lines: true } },
                },
              });
              expect(order.totalAmount.toFixed(2)).toBe('153.35');
              expect(
                isTrustedAdminItemPricingSnapshot(
                  order.items[0].pricingSnapshot,
                  order.items[0],
                ),
              ).toBe(true);
              expect(
                isTrustedAdminPackagingPricingSnapshot(
                  order.packagingGroups[0].pricingSnapshot,
                  order.packagingGroups[0],
                ),
              ).toBe(true);
              if (behalf) {
                let token = '';
                try {
                  await finalizeExternalOrderQuoteInTx(
                    tx,
                    created.id,
                    owner.id,
                    new Date(),
                  );
                } catch (error) {
                  if (!(error instanceof ExternalOrderQuoteChangedError))
                    throw error;
                  token = error.quoteToken;
                  expect(Number(error.quotedFee)).toBeGreaterThanOrEqual(
                    153.35,
                  );
                }
                await finalizeExternalOrderQuoteInTx(
                  tx,
                  created.id,
                  owner.id,
                  new Date(),
                  token,
                );
                order = await tx.order.findUniqueOrThrow({
                  where: { id: created.id },
                  include: {
                    items: true,
                    packagingGroups: { include: { lines: true } },
                  },
                });
                expect(order.items[0].subtotal.toFixed(2)).toBe('123.45');
                expect(order.packagingGroups[0].subtotal.toFixed(2)).toBe(
                  '29.90',
                );
              }
            }
            const created = await createOrder(input(true, false), owner);
            let token = '';
            try {
              await finalizeExternalOrderQuoteInTx(
                tx,
                created.id,
                owner.id,
                new Date(),
              );
            } catch (error) {
              if (!(error instanceof ExternalOrderQuoteChangedError))
                throw error;
              token = error.quoteToken;
            }
            await finalizeExternalOrderQuoteInTx(
              tx,
              created.id,
              owner.id,
              new Date(),
              token,
            );
            // Standalone finalize normally runs inside submit's status transition.
            await tx.order.update({
              where: { id: created.id },
              data: { status: 'PENDING_FACTORY' },
            });
            const order = await tx.order.findUniqueOrThrow({
              where: { id: created.id },
              include: {
                items: true,
                shipments: { orderBy: { sequence: 'asc' } },
              },
            });
            const split = {
              orderId: order.id,
              sourceShipmentId: order.shipments[0].id,
              expectedRevision: order.revision,
              expectedEditVersion: order.editVersion,
              expectedWorkOrderVersion: order.workOrderVersion,
              expectedPriceRevision: order.priceRevision,
              receiverName: '分货测试',
              receiverPhone: '13800138000',
              receiverAddress: '广东省佛山市分货测试路',
              destinationProvince: '广东',
              lines: [{ orderItemId: order.items[0].id, quantity: 3 }],
            };
            const preview = await addOrderShipment(split, owner, 'preview');
            expect(preview!.packaging[0]).toMatchObject({
              boxCount: 14,
              subtotal: '32.20',
              delta: '2.30',
            });
            expect(
              preview!.charges.every((row) => row.shippingFee === null),
            ).toBe(true);
            await addOrderShipment(
              { ...split, previewToken: preview!.token },
              owner,
              'save',
            );
            const after = await tx.order.findUniqueOrThrow({
              where: { id: order.id },
              include: {
                items: true,
                packagingGroups: { include: { lines: true } },
                shipments: { include: { lines: true } },
                customerCharges: { include: { category: true } },
              },
            });
            expect(after.packagingAmount.toFixed(2)).toBe('32.20');
            expect(
              after.customerCharges
                .filter((charge) => charge.category.code === 'SHIPPING_FEE')
                .every(
                  (charge) =>
                    charge.status === 'PENDING_AMOUNT' &&
                    charge.amount === null,
                ),
            ).toBe(true);
            expect(
              deriveProductionOperationPlan({
                orderId: after.id,
                items: after.items,
                packagingGroups: after.packagingGroups,
                shipments: after.shipments,
              }).ok,
            ).toBe(true);
            // Independent production fixture: the assertion under test is the published payroll unit.
            await tx.order.update({
              where: { id: after.id },
              data: {
                status: 'CONFIRMED',
                pricingStatus: 'ADMIN_CONFIRMED',
                pricingConfirmedAt: new Date(),
                pricingConfirmedById: owner.id,
              },
            });
            await activateProductionOperationsInTx(
              tx,
              after.id,
              owner,
              undefined,
              { targetStatus: 'RELEASED' },
            );
            const operation = await tx.productionOperation.findFirstOrThrow({
              where: { orderId: after.id, unit: 'PER_BOX' },
            });
            const packer = await tx.user.create({
              data: {
                username: `e2e-box-${randomUUID()}`,
                password: 'unused-test-password-hash',
                displayName: '装盒回归师傅',
                role: 'WORKER',
                workerType: 'PACKER',
                isActive: true,
              },
            });
            await expect(
              reportProductionOperation(
                {
                  operationId: operation.id,
                  completedQty: 1,
                  workOrderProgressQuantity: 8,
                  defectQty: 0,
                  reworkQty: 0,
                  idempotencyKey: randomUUID(),
                },
                packer,
              ),
            ).rejects.toThrow('装盒工价尚未发布');
            const seed = await tx.pieceworkPriceBook.findUniqueOrThrow({
              where: { version: 1 },
              include: { rules: true },
            });
            expect(seed.status).toBe('DRAFT');
            const initialTime = new Date();
            await publishPieceworkPriceBook(
              {
                manifest: {
                  schemaVersion: 1,
                  priceBookVersion: 1,
                  effectiveFrom: initialTime.toISOString(),
                  sourceName: '隔离回归基础工价',
                  publishNote: '验证旧工价衔接',
                  rules: seed.rules.map((rule) => ({
                    operationType: rule.operationType,
                    unit: rule.unit,
                    amount: '0.10',
                  })),
                },
                expectedDraftUpdatedAt: seed.updatedAt,
                sourceSha256: 'b'.repeat(64),
                actor: { ...owner, username: String(owner.username) },
              },
              initialTime,
            );
            const previous = await tx.pieceworkPriceBook.findFirstOrThrow({
              where: { status: 'PUBLISHED', effectiveTo: null },
              include: { rules: true },
              orderBy: { version: 'desc' },
            });
            const effective = new Date(Date.now() + 1000);
            const receipt = await publishPieceworkPriceBook({
              manifest: {
                schemaVersion: 1,
                priceBookVersion: previous.version + 1,
                effectiveFrom: effective.toISOString(),
                sourceName: '隔离回归测试工价',
                publishNote: '验证装盒报工',
                rules: [
                  ...previous.rules.map((rule) => ({
                    operationType: rule.operationType,
                    unit: rule.unit,
                    amount: rule.amount!.toString(),
                  })),
                  { operationType: 'PACKING', unit: 'PER_BOX', amount: '0.20' },
                ],
              },
              expectedDraftUpdatedAt: previous.updatedAt,
              sourceSha256: 'a'.repeat(64),
              actor: { ...owner, username: String(owner.username) },
            });
            await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
            await vi.waitFor(
              () =>
                expect(Date.now()).toBeGreaterThanOrEqual(effective.getTime()),
              { timeout: 3000, interval: 50 },
            );
            const report = await reportProductionOperation(
              {
                operationId: operation.id,
                completedQty: 1,
                workOrderProgressQuantity: 8,
                defectQty: 0,
                reworkQty: 0,
                idempotencyKey: randomUUID(),
              },
              packer,
            );
            expect(report.amount).toBe('0.20');
            const stored = await tx.productionReport.findUniqueOrThrow({
              where: { id: report.reportId },
            });
            expect(stored.priceBookId).toBe(receipt.bookId);
            expect(stored.unit).toBe('PER_BOX');
            await tx.$executeRawUnsafe('SAVEPOINT immutable_wage');
            await expect(
              tx.pieceworkPriceRule.update({
                where: { id: previous.rules[0].id },
                data: { amount: '0.90' },
              }),
            ).rejects.toThrow();
            await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT immutable_wage');
            await tx.$executeRawUnsafe('SAVEPOINT missing_successor');
            await expect(
              tx.pieceworkPriceBook.update({
                where: { id: receipt.bookId },
                data: { effectiveTo: new Date(Date.now() + 60000) },
              }),
            ).rejects.toThrow();
            await tx.$executeRawUnsafe(
              'ROLLBACK TO SAVEPOINT missing_successor',
            );
            expect(
              (
                await tx.pieceworkPriceBook.findUniqueOrThrow({
                  where: { id: previous.id },
                })
              ).effectiveTo?.toISOString(),
            ).toBe(effective.toISOString());
          } finally {
            nested.mockRestore();
          }
          throw rollback;
        },
        { timeout: 30000 },
      );
    } catch (error) {
      if (error !== rollback) throw error;
    }
  }, 40000);
});
