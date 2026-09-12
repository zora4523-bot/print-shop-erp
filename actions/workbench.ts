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
import { canonicalizeCreateOrderPaperFact } from '@/lib/price/create-order/canonical-facts';
import {
  catalogPricingFactChoices,
  parseCatalogPaperWeight,
} from '@/lib/order/catalog-pricing-facts';
import {
  productCategoryMatchesPricingRoute,
  requiredPricingCraftGroups,
} from '@/lib/order/pricing-route';
import {
  calculateCreateOrderQuoteFromCatalogInTx,
  CreateOrderQuoteError,
} from '@/lib/order/create-order-quote-service';
import {
  suggestWorkbenchAmount,
  workbenchPricingReasons,
  workbenchQuoteSchema,
  type WorkbenchQuoteResult,
} from '@/lib/workbench/quote';

const QUOTE_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  烫金款必须选择正面烫金颜色: '请至少选择一种正面烫金颜色后自动计算',
  专版烫金只能使用正面:
    '专版反面烫金暂不支持自动报价；如需反面烫金，请联系管理员核价',
  彩印叠加专版烫金只能使用正面:
    '彩印加反面烫金暂不支持自动报价；如需反面烫金，请联系管理员核价',
};

function quoteFailureMessage(error: unknown): string {
  if (error instanceof CreateOrderQuoteError) {
    const messages = error.message.split('；').map((message) => {
      if (
        message === '款式 1 的规格无法唯一解析' ||
        message.startsWith('款式 1 的规格不属于已定义计价组：')
      ) {
        return '所选规格无法自动报价，请选择其他规格或联系管理员补充产品资料';
      }
      const itemMessage = message.replace(/^款式 1：/, '');
      return Object.hasOwn(QUOTE_ERROR_MESSAGES, itemMessage)
        ? QUOTE_ERROR_MESSAGES[itemMessage]
        : undefined;
    });
    if (messages.length && messages.every(Boolean))
      return [...new Set(messages)].join('；');
  }
  return '暂无法取得当前报价，请重试；仍无法计算时请联系管理员核价';
}

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
    // Keep the catalog-validated identity and weight separate. The display
    // prefix must not consume the persisted/order paper name's 32 characters.
    const paperFact = canonicalizeCreateOrderPaperFact(
      input.paperType,
      paperWeightGsm,
    );
    if (!paperFact || paperFact.paperType.length > 32)
      return {
        status: 'error',
        message: '所选纸张名称暂不支持自动报价，请联系管理员核价',
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
          paperType: paperFact.paperType,
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
          ({ name, rate, units, amount, adjustmentType, ruleCode }) => {
            // Machine fees already include the quantity and every front/back
            // pass. The presenter has no standalone rate for this combination;
            // show its whole-item amount once instead of multiplying it again.
            const wholeItemAmount =
              ruleCode === 'PARTIAL_MACHINE' ||
              adjustmentType === 'PER_ORDER' ||
              adjustmentType === 'FIXED_AMOUNT';
            return {
              name,
              rate: wholeItemAmount ? amount : rate,
              units: wholeItemAmount ? '1' : units,
              amount,
            };
          },
        ),
        needsPricing: !preview.complete,
        pricingReasons: preview.complete
          ? []
          : workbenchPricingReasons(calculated.quote.items[0]!.manualReasons),
        plateFeePending: presentCreateOrderPlateFee(calculated.quote) !== null,
        processingVersion: calculated.quote.priceVersion.processing.version,
      },
    };
  } catch (error) {
    return {
      status: 'error',
      message: quoteFailureMessage(error),
    };
  }
}
