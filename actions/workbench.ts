'use server';

import {
  OrderItemPricingRoute,
  OrderLamination,
} from '@/generated/prisma/enums';
import { requirePermission } from '@/lib/auth/permissions';
import { createOrderQuoteItemsSchema } from '@/lib/auth/schemas';
import { db } from '@/lib/db';
import { listActiveCraftOrderOptions } from '@/lib/craft';
import { listExternalCreateOrderOptions } from '@/lib/order/create-order-options';
import { presentCreateOrderPlateFee } from '@/lib/order/create-order-quote-presentation';
import { workbenchPaperChoices } from '@/lib/workbench/catalog';
import {
  catalogPricingFactChoices,
  parseCatalogPaperWeight,
} from '@/lib/order/catalog-pricing-facts';
import {
  productCategoryMatchesPricingRoute,
  requiredPricingCraftGroups,
} from '@/lib/order/pricing-route';
import { calculateCreateOrderQuoteFromCatalogInTx } from '@/lib/order/create-order-quote-service';
import {
  suggestWorkbenchAmount,
  workbenchQuoteSchema,
  type WorkbenchQuoteResult,
} from '@/lib/workbench/quote';

export async function quoteWorkbenchAction(
  raw: unknown,
): Promise<WorkbenchQuoteResult> {
  await requirePermission('order:create');
  const parsed = workbenchQuoteSchema.safeParse(raw);
  if (!parsed.success)
    return { status: 'error', message: '请检查产品、数量和工艺选项后重新计算' };
  const input = parsed.data;
  try {
    const [options, crafts] = await Promise.all([
      listExternalCreateOrderOptions(),
      listActiveCraftOrderOptions(),
    ]);
    const product = options.products.find(
      (item) => item.id === input.productId,
    );
    if (
      !product ||
      !productCategoryMatchesPricingRoute(
        input.pricingRoute,
        product.category,
      ) ||
      !catalogPricingFactChoices(product.specification).includes(
        input.specification,
      ) ||
      !workbenchPaperChoices(product, options.papers).includes(input.paperType)
    ) {
      return {
        status: 'error',
        message: '产品选项已变更，请刷新页面后重新选择',
      };
    }
    const paperWeightGsm =
      parseCatalogPaperWeight(input.paperType) ?? product.weight;
    if (paperWeightGsm == null)
      return {
        status: 'error',
        message: '所选纸张缺少克重，请联系管理员补充产品资料后再计算',
      };
    const colors = [...input.frontFoilColors, ...input.backFoilColors];
    if (
      colors.some(
        (color) => !options.foilColors.some((option) => option.name === color),
      )
    ) {
      return {
        status: 'error',
        message: '烫金颜色已变更，请刷新页面后重新选择',
      };
    }
    const groups = requiredPricingCraftGroups({
      route: input.pricingRoute,
      ...input,
      foilColors: [],
    });
    const selectedCrafts = groups.map((group) =>
      crafts.find((craft) => group.anyOfCodes.includes(craft.code)),
    );
    if (selectedCrafts.some((craft) => !craft))
      return {
        status: 'error',
        message: '所选工艺暂无法计算，请联系管理员核价',
      };
    const validated = createOrderQuoteItemsSchema.safeParse({
      items: [
        {
          ...input,
          actualWidthMm: null,
          actualHeightMm: null,
          paperWeightGsm,
          crafts: selectedCrafts.flatMap((craft) => (craft ? [craft.id] : [])),
          hasLocalFoil:
            input.pricingRoute === OrderItemPricingRoute.STOCK_BLANK,
          lamination: OrderLamination.NONE,
          printColors:
            input.pricingRoute === OrderItemPricingRoute.COLOR_PRINT
              ? ['C', 'M', 'Y', 'K']
              : [],
        },
      ],
      orderItemCount: 1,
    });
    if (!validated.success)
      return {
        status: 'error',
        message: '工艺组合不完整，请检查正反面烫金颜色与工艺后重新计算',
      };
    const item = validated.data.items[0]!;
    const calculated = await db.$transaction((tx) =>
      calculateCreateOrderQuoteFromCatalogInTx(tx, {
        now: new Date(),
        includeOrderCharges: false,
        facts: {
          items: [
            { ...item, pricingRoute: input.pricingRoute, itemKey: '1', fig: 1 },
          ],
          packagingGroups: [],
          isSfCollect: false,
          shipments: [
            {
              shipmentKey: 'workbench',
              province: null,
              itemQuantities: { '1': input.quantity },
            },
          ],
        },
      }),
    );
    const preview = calculated.processing.items[0]!;
    const baseAmount = preview.complete ? preview.suggestedSubtotal : null;
    return {
      status: 'success',
      quote: {
        baseAmount,
        ...suggestWorkbenchAmount(baseAmount, input.markup),
        lines: preview.components.map(
          ({ name, rate, units, amount, adjustmentType }) => ({
            name,
            rate:
              adjustmentType === 'PER_ORDER' ||
              adjustmentType === 'FIXED_AMOUNT'
                ? amount
                : rate,
            units:
              adjustmentType === 'PER_ORDER' ||
              adjustmentType === 'FIXED_AMOUNT'
                ? '1'
                : units,
            amount,
          }),
        ),
        needsPricing: !preview.complete,
        plateFeePending: presentCreateOrderPlateFee(calculated.quote) !== null,
        processingVersion: calculated.quote.priceVersion.processing.version,
      },
    };
  } catch {
    return {
      status: 'error',
      message: '暂无法取得当前报价，请重试；仍无法计算时请联系管理员核价',
    };
  }
}
