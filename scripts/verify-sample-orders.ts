/** Run with: SAMPLE_TEST_DATABASE_URL=... node --conditions=react-server --import tsx scripts/verify-sample-orders.ts */
import 'dotenv/config';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import type { Prisma, Role } from '../generated/prisma/client';
type TestOrder = Prisma.OrderGetPayload<{
  include: { shipments: true; customerCharges: true };
}>;
type PricingServices = {
  db: (typeof import('../lib/db'))['db'];
  admin: { id: string; role: Role };
  sales: { id: string; role: Role };
  releaseFactoryOrder: (typeof import('../lib/order/admin-workflow'))['releaseFactoryOrder'];
  previewOrderPricingReview: (typeof import('../lib/order/pricing-review'))['previewOrderPricingReview'];
  finalizeOrderPricing: (typeof import('../lib/order/pricing-review'))['finalizeOrderPricing'];
  previewFulfillmentPricing: (typeof import('../lib/order/fulfillment-pricing'))['previewFulfillmentPricing'];
  finalizeFulfillmentPricing: (typeof import('../lib/order/fulfillment-pricing'))['finalizeFulfillmentPricing'];
};

async function main() {
  const target = process.env.SAMPLE_TEST_DATABASE_URL;
  if (!target)
    throw new Error('请显式设置独立可丢弃数据库 SAMPLE_TEST_DATABASE_URL');
  const url = new URL(target);
  if (
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    !/^\/(erp_samples_test_|e2e_)/.test(url.pathname) ||
    target === process.env.DATABASE_URL
  )
    throw new Error('仅允许独立本地样品测试数据库');
  process.env.DATABASE_URL = target;
  process.env.BACKGROUND_JOBS_MODE = 'durable';
  process.env.NOTIFICATION_MOCK_MODE = 'true';
  const { db } = await import('../lib/db');
  const { createOrderSchema } = await import('../lib/auth/schemas');
  const { createOrder, submitOrder } = await import('../lib/order');
  const { quoteSampleOrder } = await import('../lib/order/sample-order');
  const { releaseFactoryOrder } = await import('../lib/order/admin-workflow');
  const { previewOrderPricingReview, finalizeOrderPricing } = await import(
    '../lib/order/pricing-review'
  );
  const { previewFulfillmentPricing, finalizeFulfillmentPricing } =
    await import('../lib/order/fulfillment-pricing');
  const { registerShipment } = await import(
    '../lib/order/shipment-registration'
  );
  const { loadExternalCreateOrderBootstrap } = await import(
    '../lib/order/create-order-bootstrap'
  );
  const { listActiveCraftOrderOptions } = await import('../lib/craft');
  const { createExternalOrderItem, createBlankItem } = await import(
    '../lib/order/order-item-configuration'
  );
  const { parseExternalCreateOrderCommand } = await import(
    '../lib/order/external-create-order-command'
  );
  const { buildExternalCreateOrderPayload } = await import(
    '../lib/order/external-create-order-payload'
  );
  try {
    const password = await bcrypt.hash('e2e-test-password-1234', 10);
    const admin = await db.user.upsert({
      where: { username: 'e2e-sample-admin' },
      create: {
        username: 'e2e-sample-admin',
        displayName: '样品验收管理员',
        role: 'ADMIN',
        password,
      },
      update: { password, isActive: true },
    });
    const sales = await db.user.upsert({
      where: { username: 'e2e-sample-sales' },
      create: {
        username: 'e2e-sample-sales',
        displayName: '样品验收销售',
        role: 'SALES',
        password,
      },
      update: { password, isActive: true },
    });
    const other = await db.user.upsert({
      where: { username: 'e2e-sample-other' },
      create: {
        username: 'e2e-sample-other',
        displayName: '样品验收其他销售',
        role: 'SALES',
        password,
      },
      update: { password, isActive: true },
    });
    const { options } = await loadExternalCreateOrderBootstrap();
    const crafts = await listActiveCraftOrderOptions();
    const pricingServices = {
      db,
      admin,
      sales,
      releaseFactoryOrder,
      previewOrderPricingReview,
      finalizeOrderPricing,
      previewFulfillmentPricing,
      finalizeFulfillmentPricing,
    };
    for (const [purpose, collect, adminCreated] of [
      ['SAMPLE_SHIPMENT', true, false],
      ['SAMPLE_SHIPMENT', false, false],
      ['SAMPLE_SHIPMENT', false, true],
      ['PROOF', false, false],
    ] as const) {
      const creator = adminCreated ? admin : sales;
      const item =
        purpose === 'PROOF'
          ? {
              ...createExternalOrderItem(
                crafts,
                options.products,
                options.papers,
                options.foilColors[0]?.name,
              ),
              quantity: 3,
            }
          : {
              ...createBlankItem([]),
              name: '寄样回归',
              quantity: 3,
              pricingRoute: 'MANUAL_QUOTE',
              pack: null,
              crafts: [],
              frontFoilColors: [],
              backFoilColors: [],
              foilColors: [],
              foilTechnique: 'NONE',
              hasLocalFoil: null,
            };
      const input = createOrderSchema.parse({
        purpose,
        customName: purpose === 'PROOF' ? item.name : '寄样回归',
        clientSubmissionId: crypto.randomUUID(),
        customerRef: null,
        receiverName: '测试收件人',
        receiverPhone: '13800000000',
        receiverAddress: '浙江省杭州市测试地址',
        destinationProvince: '浙江',
        expressCode: null,
        packageRequirement: null,
        remark: '独立数据库回归',
        isUrgent: false,
        isSfCollect: collect,
        items: [item],
        additionalShipments: [],
        packagingGroups:
          purpose === 'PROOF'
            ? [
                {
                  name: null,
                  mode: 'SINGLE_STYLE',
                  actualBagCount: 3,
                  itemUnitsPerBag: [1],
                },
              ]
            : [],
      });
      const command = parseExternalCreateOrderCommand(
        buildExternalCreateOrderPayload(input),
      );
      assert(command.success, JSON.stringify(command));
      const quote = await quoteSampleOrder(command.data);
      if (purpose === 'PROOF') assert.equal(quote.total, null);
      // 业主 2026-09-24：管理员代建必须指定外部销售。
      const createCommand = adminCreated
        ? { ...command.data, externalSalesUserId: sales.id }
        : command.data;
      const created = await createOrder(createCommand, creator);
      const replay = await createOrder(createCommand, creator);
      assert.equal(created.id, replay.id);
      await assert.rejects(() =>
        submitOrder(created.id, other, new Date(), quote.quoteToken),
      );
      await assert.rejects(() => previewOrderPricingReview(created.id, sales));
      await assert.rejects(() =>
        submitOrder(created.id, creator, new Date(), 'stale-token'),
      );
      assert.equal(
        (await db.order.findUniqueOrThrow({ where: { id: created.id } }))
          .status,
        'DRAFT',
      );
      if (purpose === 'PROOF') {
        await assert.rejects(
          () => submitOrder(created.id, creator, new Date(), quote.quoteToken),
          /设计图片/,
        );
        // Image fixture; real OSS transfer is outside this isolated test.
        await db.orderItemDesign.create({
          data: {
            orderItemId: created.itemIds[0],
            fileType: 'IMAGE',
            fileName: 'fixture.png',
            fileUrl:
              'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMioAAAAASUVORK5CYII=',
            fileSize: 68,
            uploadedBy: sales.id,
          },
        });
      }
      await submitOrder(created.id, creator, new Date(), quote.quoteToken);
      let order = await db.order.findUniqueOrThrow({
        where: { id: created.id },
        include: { shipments: true, customerCharges: true },
      });
      assert.equal(order.processingAmount.toFixed(2), '0.00');
      assert.equal(order.settlementType, 'EXTERNAL_SALES');
      if (purpose === 'PROOF')
        order = await verifyProofPricing(order, pricingServices);
      // 业主 2026-09-30：寄付样品按首重自动计费；管理员代建那张验证超重改价入口。
      const prepaidSettled =
        purpose === 'SAMPLE_SHIPMENT' && !collect
          ? await verifyPrepaidSample(order, quote, adminCreated, pricingServices)
          : null;
      order = await db.order.findUniqueOrThrow({
        where: { id: order.id },
        include: { shipments: true, customerCharges: true },
      });
      const releaseInput = {
        orderId: order.id,
        expectedRevision: order.revision,
        expectedWorkOrderVersion: order.workOrderVersion,
        printIdempotencyKey: crypto.randomUUID(),
      };
      const released = await releaseFactoryOrder(releaseInput, admin);
      assert.equal(
        released.status,
        purpose === 'PROOF' ? 'RELEASED' : 'PACKING',
      );
      assert.equal(
        (await releaseFactoryOrder(releaseInput, admin)).idempotentReplay,
        true,
      );
      assert.equal(
        (await db.productionOperation.count({ where: { orderId: order.id } })) >
          0,
        purpose === 'PROOF',
      );
      if (purpose === 'PROOF') {
        await assert.rejects(
          () =>
            previewFulfillmentPricing(
              { orderId: order.id, isSfCollect: false },
              admin,
            ),
          // Proofs do not bill logistics, so the eligibility gate rejects first.
          /整单总价|不允许履约费用更正/,
        );
        // Explicit completed-production fixture: does not claim to test worker reporting.
        await db.productionOperation.updateMany({
          where: { orderId: order.id },
          data: { status: 'COMPLETED' },
        });
        await db.productionProgressStep.updateMany({
          where: { orderId: order.id },
          data: { status: 'COMPLETED' },
        });
        await db.order.update({
          where: { id: order.id },
          data: { status: 'PACKING' },
        });
      }
      order = await db.order.findUniqueOrThrow({
        where: { id: order.id },
        include: { shipments: true, customerCharges: true },
      });
      const shipment = order.shipments[0];
      const shipInput = {
        orderId: order.id,
        shipmentId: shipment.id,
        expectedVersion: shipment.registrationVersion,
        expectedRevision: order.revision,
        expectedEditVersion: order.editVersion,
        expectedWorkOrderVersion: order.workOrderVersion,
        expectedPriceRevision: order.priceRevision,
        idempotencyKey: crypto.randomUUID(),
        carrierCode: collect ? ('SF' as const) : ('ZTO' as const),
        carrierName: '',
        trackingNo: 'TEST123456789',
        confirm: true,
      };
      await registerShipment(shipInput, admin);
      const final = await db.order.findUniqueOrThrow({
        where: { id: order.id },
        include: { customerCharges: true },
      });
      assert.equal(final.status, 'SETTLED');
      await assert.rejects(
        () => previewOrderPricingReview(order.id, admin),
        /已结算/,
      );
      assert.equal(
        final.settledFee?.toFixed(2),
        purpose === 'PROOF' ? '88.00' : (prepaidSettled ?? quote.total),
      );
      assert.equal(final.totalAmount.toFixed(2), final.settledFee?.toFixed(2));
      assert.equal(
        final.customerCharges.reduce(
          (sum, line) => sum + Number(line.amount),
          0,
        ),
        Number(final.settledFee),
      );
      console.log(
        `${adminCreated ? '管理员' : '销售'}${purpose}${collect ? '到付' : '寄付'}: 创建/权限/报价/核价/下发/打印请求重试/结算通过 ${order.orderNo}`,
      );
    }
  } finally {
    await db.$disconnect();
  }
}
async function verifyProofPricing(order: TestOrder, services: PricingServices) {
  const {
    db,
    admin,
    sales,
    releaseFactoryOrder,
    previewOrderPricingReview,
    finalizeOrderPricing,
  } = services;
  assert.equal(order.pricingStatus, 'PENDING_ADMIN_CONFIRMATION');
  await assert.rejects(() =>
    releaseFactoryOrder(
      {
        orderId: order.id,
        expectedRevision: order.revision,
        expectedWorkOrderVersion: order.workOrderVersion,
        printIdempotencyKey: crypto.randomUUID(),
        createPrint: false,
      },
      admin,
    ),
  );
  const preview = await previewOrderPricingReview(order.id, admin);
  const command = {
    orderId: order.id,
    expectedOrderRevision: preview.orderRevision,
    expectedPriceRevision: preview.priceRevision,
    items: [],
    packagingGroups: preview.packagingGroups.map((g) => ({
      packagingGroupId: g.packagingGroupId,
      expectedMode: g.mode,
      expectedActualBagCount: g.actualBagCount,
    })),
    orderCharges: preview.orderCharges.map((c) => ({
      chargeId: c.chargeId,
      expectedBusinessKey: c.businessKey,
      amount: '88.00',
      reason: '打样整单价',
    })),
    shipments: [],
    remark: null,
  };
  for (const amount of ['', '-1', '88.001', '10000000000'])
    await assert.rejects(() =>
      finalizeOrderPricing(
        {
          ...command,
          orderCharges: command.orderCharges.map((row) => ({
            ...row,
            amount,
          })),
        },
        admin,
      ),
    );
  await assert.rejects(() => finalizeOrderPricing(command, sales));
  await finalizeOrderPricing(command, admin);
  await assert.rejects(
    () => finalizeOrderPricing(command, admin),
    /已被其他人更新|已变更|已变化/,
  );
  for (const amount of ['0.00', '88.00']) {
    const revised = await previewOrderPricingReview(order.id, admin);
    await finalizeOrderPricing(
      {
        ...command,
        expectedOrderRevision: revised.orderRevision,
        expectedPriceRevision: revised.priceRevision,
        orderCharges: command.orderCharges.map((row) => ({
          ...row,
          amount,
          reason: '整单价调整回归',
        })),
      },
      admin,
    );
    assert.equal(
      (
        await db.order.findUniqueOrThrow({ where: { id: order.id } })
      ).confirmedFee?.toFixed(2),
      amount,
    );
  }
  const priced = await db.order.findUniqueOrThrow({
    where: { id: order.id },
    include: { shipments: true, customerCharges: true },
  });
  assert.equal(priced.totalAmount.toFixed(2), '88.00');
  assert.equal(priced.customerCharges.length, 1);

  return priced;
}
async function verifyPrepaidSample(
  order: TestOrder,
  quote: { total: string | null; shippingAmount: string | null; packagingAmount: string | null },
  correctWeight: boolean,
  services: PricingServices,
) {
  const { admin, previewFulfillmentPricing, finalizeFulfillmentPricing } = services;
  assert.equal(quote.shippingAmount, '2.80');
  assert.equal(order.pricingStatus, 'AUTO_CONFIRMED');
  assert.equal(order.status, 'CONFIRMED');
  assert.equal(order.confirmedFee?.toFixed(2), quote.total);
  assert(order.shipments.every((row) => row.weightKg?.toString() === '1'));
  if (!correctWeight) return quote.total;
  // Overweight after all: the administrator records 2 kg and leaves the fee
  // blank, so it is recomputed from the order's logistics price book.
  const shipping = {
    orderId: order.id,
    isSfCollect: false,
    shipments: order.shipments.map((row) => ({
      shipmentId: row.id,
      destinationProvince: row.destinationProvince,
      weightKg: '2.00',
      shippingFee: null,
      customerChargeOverrideReason: null,
    })),
  };
  const preview = await previewFulfillmentPricing(shipping, admin);
  assert(preview.canConfirm, JSON.stringify(preview.issues));
  assert.equal(preview.shipments[0]?.shippingFee, '5.60');
  await finalizeFulfillmentPricing(
    {
      ...shipping,
      expectedOrderRevision: preview.expectedOrderRevision,
      expectedEditVersion: preview.expectedEditVersion,
      expectedWorkOrderVersion: preview.expectedWorkOrderVersion,
      expectedPriceRevision: preview.expectedPriceRevision,
      previewToken: preview.previewToken,
      idempotencyKey: crypto.randomUUID(),
    },
    admin,
  );
  return (5.6 + Number(quote.packagingAmount)).toFixed(2);
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
