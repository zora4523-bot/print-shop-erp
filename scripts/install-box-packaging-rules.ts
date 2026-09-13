/** Deployment data step after the packaging migrations. Published histories are immutable. */
import 'dotenv/config';
import { db } from '../lib/db';
import {
  createCustomerPriceBookDraft,
  prepareConfirmedBoxPackagingDraft,
  publishCustomerPriceBookDraft,
} from '../lib/price/customer-price-book-admin';
import { BOX_PRICE_RULES } from '../lib/price/box-packaging-rules';

async function main() {
  const args = process.argv.slice(2);
  const actorId = args.find((arg) => arg.startsWith('--actor='))?.slice(8);
  const actor = actorId ? await db.user.findUnique({ where: { id: actorId } }) : null;
  if (!actor || actor.role !== 'ADMIN' || !actor.isActive)
    throw new Error('请用 --actor=指定启用的管理员账号 ID');
  const current = await db.customerPriceBook.findFirstOrThrow({
    where: {
      purpose: 'PROCESSING',
      settlementType: 'EXTERNAL_SALES',
      isActive: true,
      effectiveFrom: { lte: new Date() },
      effectiveTo: null,
    },
    include: { rules: true },
  });
  if (
    BOX_PRICE_RULES.every((box) =>
      current.rules.some((rule) => rule.code === box.code && rule.isActive),
    )
  ) {
    console.log(JSON.stringify({ status: 'already-installed', version: current.version }));
    return;
  }
  if (!args.includes('--apply')) {
    console.log(
      JSON.stringify({
        status: 'dry-run',
        currentVersion: current.version,
        rules: BOX_PRICE_RULES.map((rule) => rule.code),
      }),
    );
    return;
  }
  const draft =
    (await db.customerPriceBook.findFirst({
      where: {
        purpose: 'PROCESSING',
        settlementType: 'EXTERNAL_SALES',
        isActive: false,
        notes: { path: ['workflow', 'status'], equals: 'DRAFT' },
      },
    })) ??
    (await createCustomerPriceBookDraft(
      { purpose: 'PROCESSING', changeReason: '新增用户确认的空盒和装盒加工费' },
      actor,
    ));
  const fresh = await db.customerPriceBook.findUniqueOrThrow({ where: { id: draft.id } });
  const prepared = await prepareConfirmedBoxPackagingDraft(
    { priceBookId: draft.id, expectedDraftUpdatedAt: fresh.updatedAt },
    actor,
  );
  const published = await publishCustomerPriceBookDraft(
    {
      priceBookId: prepared.id,
      expectedDraftUpdatedAt: prepared.updatedAt,
      confirmedHighRisk: true,
      publishNote: '2026-09-13 用户确认：红卡空盒1.3元、触感空盒1.8元，装盒加工费0.5元/盒',
    },
    actor,
  );
  console.log(JSON.stringify({ status: 'published', ...published }));
}
main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
