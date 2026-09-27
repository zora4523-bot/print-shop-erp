import {
  OrderSettlementType,
  Role,
} from '../../../../generated/prisma/enums';
import { db } from '../../../db';
import {
  getAdminOrderByOrderNo,
  loadAdminOrderWorkspace,
} from '../../admin-workspace';
import { parseAdminOrderWorkspaceQuery } from '../../admin-workspace-query';

const warningFragment =
  'Calling client.query() when the client is already executing a query';
const fixtureId = 'pg-warning-probe-order';
const fixtureOrderNo = 'PG-WARNING-PROBE';
const warnings: string[] = [];

process.on('warning', (warning) => {
  if (warning.name === 'DeprecationWarning') {
    warnings.push(warning.message);
  }
});

async function main() {
  const admin = await db.user.findFirst({
    where: { role: Role.ADMIN, isActive: true },
    select: { id: true },
  });
  if (!admin) throw new Error('pg warning probe requires an active admin');

  await cleanupFixture();
  try {
    await db.order.create({
      data: {
        id: fixtureId,
        orderNo: fixtureOrderNo,
        submitterId: admin.id,
        submitterRole: Role.SALES,
        createdById: admin.id,
        settlementType: OrderSettlementType.EXTERNAL_SALES,
        customerRef: fixtureOrderNo,
        customName: 'PostgreSQL 单连接查询串行化探针',
        createdAt: new Date('2099-01-01T00:00:00.000Z'),
        stars: { create: { userId: admin.id } },
      },
    });

    const page = await loadAdminOrderWorkspace(
      { id: admin.id, role: Role.ADMIN },
      parseAdminOrderWorkspaceQuery({
        queue: 'all',
        q: fixtureOrderNo,
      }).query,
      new Date('2026-09-02T00:00:00.000Z'),
      2,
    );

    const detail = await getAdminOrderByOrderNo(
      { id: admin.id, role: Role.ADMIN },
      fixtureOrderNo,
      new Date('2026-09-02T00:00:00.000Z'),
      2,
    );

    await new Promise<void>((resolve) => setImmediate(resolve));
    console.log(
      `__PG_WARNING_PROBE__${JSON.stringify({
        rows: page.rows.length,
        total: page.total,
        fixtureFound: page.rows.some((row) => row.id === fixtureId),
        detailFound: detail?.id === fixtureId,
        targetWarnings: warnings.filter((message) =>
          message.includes(warningFragment),
        ),
      })}`,
    );
  } finally {
    await cleanupFixture();
  }
}

async function cleanupFixture() {
  await db.order.deleteMany({
    where: {
      OR: [{ id: fixtureId }, { orderNo: fixtureOrderNo }],
    },
  });
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
