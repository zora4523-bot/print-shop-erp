/**
 * 安装 2026-09-13 用户确认的装盒价目（红卡空盒、触感空盒、装盒加工费）到当前生效的
 * 加工费价目簿：复用或新建草稿 → prepareConfirmedBoxPackagingDraft → 正式发布流程。
 * 已发布历史不可变；三条规则都已在当前版生效时直接返回 already-installed。
 *
 * 被两处调用：部署数据步骤 scripts/install-box-packaging-rules.ts（按账号 ID 指定管理员）
 * 与 E2E 隔离库准备 scripts/prepare-e2e-box-packaging.ts（按种子管理员用户名）。
 * 本模块顶层引入 Prisma，调用方若需先切换到隔离库，必须在激活后再动态 import。
 */
import type { AuditActor } from '../../lib/audit-log';
import { db } from '../../lib/db';
import { BOX_PRICE_RULES } from '../../lib/price/box-packaging-rules';
import {
  createCustomerPriceBookDraft,
  prepareConfirmedBoxPackagingDraft,
  publishCustomerPriceBookDraft,
} from '../../lib/price/customer-price-book-admin';

export const BOX_PACKAGING_PUBLISH_NOTE =
  '2026-09-13 用户确认：红卡空盒1.3元、触感空盒1.8元，装盒加工费0.5元/盒';

export type BoxPackagingInstallReceipt =
  | { status: 'already-installed'; version: number }
  | { status: 'dry-run'; currentVersion: number; rules: string[] }
  | { status: 'published'; id: string; version: number };

export async function installConfirmedBoxPackagingRules(
  actor: AuditActor,
  options: { apply: boolean },
): Promise<BoxPackagingInstallReceipt> {
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
    return { status: 'already-installed', version: current.version };
  }
  if (!options.apply) {
    return {
      status: 'dry-run',
      currentVersion: current.version,
      rules: BOX_PRICE_RULES.map((rule) => rule.code),
    };
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
      publishNote: BOX_PACKAGING_PUBLISH_NOTE,
    },
    actor,
  );
  return { status: 'published', id: published.id, version: published.version };
}
