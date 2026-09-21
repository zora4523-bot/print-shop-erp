import { describe, expect, it, vi } from 'vitest';
import {
  OrderFoilTechnique,
  OrderItemPricingRoute,
  OrderLamination,
  OrderProductStructure,
} from '../../../generated/prisma/enums';
import { calculateCreateOrderQuote } from '../../price/create-order';
import { CREATE_ORDER_GOLDEN_SNAPSHOT } from '../../price/__tests__/fixtures/create-order-golden-fixtures';
import {
  buildCreateOrderQuoteInputFromCatalog,
  CreateOrderQuoteFactsAdapterError,
  type CreateOrderQuoteFactsAdapterInput,
  type CreateOrderQuoteFactsReadClient,
  type LegacyCreateOrderQuoteItemFacts,
} from '../create-order-quote-facts-adapter';

type ProductRow = {
  id: string;
  code: string;
  category: string;
  specification: string | null;
  paperType: string | null;
  paperMaterialId: string | null;
  weight: number | null;
  isActive: boolean;
};

type CraftRow = { id: string; code: string; isActive: boolean };
type PaperRow = {
  id: string;
  name: string;
  specification: string | null;
  outOfStock: boolean;
  isActive: boolean;
};

function product(overrides: Partial<ProductRow> = {}): ProductRow {
  return {
    id: 'product-partial-large',
    code: 'EXT-STOCK-PEARL-160-LARGE',
    category: 'BLANK_STOCK',
    specification: '大号封90×165',
    paperType: '160g珠光艳闪',
    paperMaterialId: 'paper-pearl-160',
    weight: 160,
    isActive: true,
    ...overrides,
  };
}

function paper(overrides: Partial<PaperRow> = {}): PaperRow {
  return {
    id: 'paper-pearl-160',
    name: '珠光艳闪',
    specification: '160g',
    outOfStock: false,
    isActive: true,
    ...overrides,
  };
}

function craft(overrides: Partial<CraftRow> = {}): CraftRow {
  return {
    id: 'craft-partial',
    code: 'FLAT_FOIL_PARTIAL',
    isActive: true,
    ...overrides,
  };
}

function item(
  overrides: Partial<LegacyCreateOrderQuoteItemFacts> = {},
): LegacyCreateOrderQuoteItemFacts {
  return {
    itemKey: 'style-1',
    fig: 1,
    productId: 'product-partial-large',
    pricingRoute: OrderItemPricingRoute.STOCK_BLANK,
    productStructure: OrderProductStructure.STANDARD_ENVELOPE,
    pricingGroup: null,
    specification: '大号封90×165',
    actualWidthMm: 90,
    actualHeightMm: 165,
    paperType: '160g珠光艳闪',
    paperWeightGsm: 160,
    quantity: 1_000,
    crafts: ['craft-partial'],
    foilColors: ['哑金'],
    frontFoilColors: ['哑金'],
    backFoilColors: [],
    foilTechnique: OrderFoilTechnique.FLAT,
    hasLocalFoil: true,
    lamination: OrderLamination.NONE,
    ...overrides,
  };
}

function input(
  items: readonly LegacyCreateOrderQuoteItemFacts[] = [item()],
): CreateOrderQuoteFactsAdapterInput {
  return {
    items,
    packagingGroups: items.map((candidate) => ({
      groupKey: `bag-${candidate.itemKey}`,
      mode: 'SINGLE_STYLE',
      items: [{ itemKey: candidate.itemKey, unitsPerBag: 10 }],
    })),
    isSfCollect: false,
    shipments: [
      {
        shipmentKey: 'primary',
        province: '上海',
        itemQuantities: Object.fromEntries(
          items.map((candidate) => [candidate.itemKey, candidate.quantity]),
        ),
      },
    ],
  };
}

function client(args: {
  products?: readonly ProductRow[];
  crafts?: readonly CraftRow[];
  papers?: readonly PaperRow[];
} = {}): CreateOrderQuoteFactsReadClient {
  const products = args.products ?? [product()];
  const crafts = args.crafts ?? [craft()];
  const papers = args.papers ?? [paper()];
  return {
    product: { findMany: vi.fn(async () => products) },
    craft: { findMany: vi.fn(async () => crafts) },
    material: { findMany: vi.fn(async () => papers) },
  } as unknown as CreateOrderQuoteFactsReadClient;
}

async function adapterError(
  promise: Promise<unknown>,
): Promise<CreateOrderQuoteFactsAdapterError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CreateOrderQuoteFactsAdapterError);
    return error as CreateOrderQuoteFactsAdapterError;
  }
  throw new Error('预期事实适配器拒绝输入');
}

describe('buildCreateOrderQuoteInputFromCatalog', () => {
  it('空白封从纸张、标准规格与工艺推导事实，无需读取 Product', async () => {
    const db = client();

    const result = await buildCreateOrderQuoteInputFromCatalog(db, input());

    expect(result.items).toEqual([
      expect.objectContaining({
        itemKey: 'style-1',
        fig: 1,
        craft: 'PARTIAL',
        paperType: '珠光艳闪',
        paperWeightGsm: 160,
        specification: '大号封',
        pricingGroup: 'LARGE',
        productStructure: 'STANDARD_ENVELOPE',
        specialEffect: 'NONE',
        printFoilMode: 'NONE',
        configuration: {
          paper: 'CATALOG',
          paperWeight: 'CATALOG',
          specification: 'CATALOG',
          craft: 'CATALOG',
        },
      }),
    ]);
    expect(db.product.findMany).not.toHaveBeenCalled();
    expect(db.material.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { category: 'PAPER' } }),
    );
  });

  it('专版尺寸产品可组合服务端 PAPER 事实，但只有已发布纸价才自动报价', async () => {
    const customProduct = product({
      id: 'custom-large',
      code: 'EXT-CUSTOM-LARGE',
      category: 'CUSTOM_FLAT_FOIL',
      specification: '大号封90×165',
      paperType: null,
      paperMaterialId: null,
      weight: null,
    });
    const fullCraft = craft({
      id: 'craft-full',
      code: 'FLAT_FOIL_SINGLE',
    });
    const customItem = item({
      productId: customProduct.id,
      pricingRoute: OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL,
      productStructure: OrderProductStructure.STANDARD_ENVELOPE,
      quantity: 5_000,
      crafts: [fullCraft.id],
      paperType: '160g珠光艳闪',
      paperWeightGsm: 160,
      hasLocalFoil: false,
    });
    const configuredPearl = paper({
      id: 'paper-pearl-160',
      name: '160g珠光艳闪',
      specification: null,
    });
    const catalogInput = await buildCreateOrderQuoteInputFromCatalog(
      client({
        products: [customProduct],
        crafts: [fullCraft],
        papers: [configuredPearl],
      }),
      input([customItem]),
    );

    expect(catalogInput.items[0]).toMatchObject({
      craft: 'FULL',
      paperType: '珠光艳闪',
      paperWeightGsm: 160,
      specification: '大号封',
      configuration: {
        paper: 'CATALOG',
        paperWeight: 'CATALOG',
        specification: 'CATALOG',
        craft: 'CATALOG',
      },
    });
    expect(
      calculateCreateOrderQuote(catalogInput, CREATE_ORDER_GOLDEN_SNAPSHOT)
        .items[0],
    ).toMatchObject({ status: 'QUOTED', unitPrice: '0.2200' });

    const unpricedPaperInput = await buildCreateOrderQuoteInputFromCatalog(
      client({
        products: [customProduct],
        crafts: [fullCraft],
        papers: [
          paper({
            id: 'paper-unpriced-140',
            name: '140g云纹纸',
            specification: null,
          }),
        ],
      }),
      input([
        {
          ...customItem,
          paperType: '140g云纹纸',
          paperWeightGsm: 140,
        },
      ]),
    );
    const unpricedQuote = calculateCreateOrderQuote(
      unpricedPaperInput,
      CREATE_ORDER_GOLDEN_SNAPSHOT,
    );
    expect(unpricedQuote.items[0]?.status).toBe('MANUAL_PRICING_REQUIRED');
    expect(unpricedQuote.manualReasons.map((reason) => reason.code)).toContain(
      'FULL_PAPER_SURCHARGE_NOT_FOUND',
    );
  });

  it('通用专版产品按别名和克重唯一绑定 PAPER 身份', async () => {
    const customProduct = product({
      id: 'custom-large',
      code: 'EXT-CUSTOM-LARGE',
      category: 'CUSTOM_FLAT_FOIL',
      paperType: null,
      paperMaterialId: null,
      weight: null,
    });
    const fullCraft = craft({ id: 'craft-full', code: 'FLAT_FOIL_SINGLE' });
    const customItem = item({
      productId: customProduct.id,
      pricingRoute: OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL,
      crafts: [fullCraft.id],
      paperType: '莱尼纹',
      paperWeightGsm: 150,
      hasLocalFoil: false,
    });
    const aliasPaper = paper({
      id: 'paper-linen-150',
      name: '150g莱尼纹 / 莱尼纹',
      specification: null,
    });

    const result = await buildCreateOrderQuoteInputFromCatalog(
      client({
        products: [customProduct],
        crafts: [fullCraft],
        papers: [aliasPaper],
      }),
      input([customItem]),
    );

    expect(result.items[0]).toMatchObject({
      paperType: '莱尼纹',
      paperWeightGsm: 150,
      configuration: { paper: 'CATALOG', paperWeight: 'CATALOG' },
    });
  });

  it.each([
    {
      label: '已停用',
      papers: [
        paper({
          id: 'paper-linen-150',
          name: '150g莱尼纹 / 莱尼纹',
          specification: null,
          isActive: false,
        }),
      ],
    },
    {
      label: '别名重复',
      papers: [
        paper({
          id: 'paper-linen-150-a',
          name: '150g莱尼纹 / 莱尼纹',
          specification: null,
        }),
        paper({
          id: 'paper-linen-150-b',
          name: '莱尼纹',
          specification: '150g',
        }),
      ],
    },
  ])('通用专版纸张$label时失败关闭', async ({ papers }) => {
    const customProduct = product({
      id: 'custom-large',
      code: 'EXT-CUSTOM-LARGE',
      category: 'CUSTOM_FLAT_FOIL',
      paperType: null,
      paperMaterialId: null,
      weight: null,
    });
    const fullCraft = craft({ id: 'craft-full', code: 'FLAT_FOIL_SINGLE' });
    const customItem = item({
      productId: customProduct.id,
      pricingRoute: OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL,
      crafts: [fullCraft.id],
      paperType: '莱尼纹',
      paperWeightGsm: 150,
      hasLocalFoil: false,
    });

    const error = await adapterError(
      buildCreateOrderQuoteInputFromCatalog(
        client({ products: [customProduct], crafts: [fullCraft], papers }),
        input([customItem]),
      ),
    );

    expect(error.code).toBe('CATALOG_PAPER_CHANGED');
  });

  it('事实层保留空白封改尺寸事实，准入层另行拒绝新业务', async () => {
    const result = await buildCreateOrderQuoteInputFromCatalog(
      client({ products: [] }), input([item({ actualWidthMm: 95, actualHeightMm: 170 })]),
    );
    expect(result.items[0]?.configuration.specification).toBe('RESIZED');
  });

  it.each(['手工纸', '客供云纹纸'])('空白封不能使用目录外纸张 %s', async (paperType) => {
    const error = await adapterError(buildCreateOrderQuoteInputFromCatalog(
      client({ products: [] }), input([item({ paperType, paperWeightGsm: 180 })]),
    ));
    expect(error.code).toBe('CATALOG_PAPER_CHANGED');
  });

  it.each([
    {
      label: '产品已停用',
      db: client({ products: [product({ category: 'CUSTOM_FLAT_FOIL', isActive: false })] }),
      request: input([item({ pricingRoute: OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL })]),
      code: 'CATALOG_PRODUCT_CHANGED',
    },
    {
      label: '产品分类与路线不符',
      db: client({ products: [product({ category: 'COLOR_PRINT' })] }),
      request: input([item({ pricingRoute: OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL })]),
      code: 'CATALOG_PRODUCT_MISMATCH',
    },
    {
      label: '工艺已停用',
      db: client({ crafts: [craft({ isActive: false })] }),
      request: input(),
      code: 'CATALOG_CRAFT_CHANGED',
    },
    {
      label: '缺少路线要求的工艺',
      db: client({ crafts: [craft({ code: 'UV' })] }),
      request: input(),
      code: 'CATALOG_CRAFT_MISMATCH',
    },
    {
      label: '纸张已停用',
      db: client({ papers: [paper({ isActive: false })] }),
      request: input(),
      code: 'CATALOG_PAPER_CHANGED',
    },
    {
      label: '纸张克重与报价事实不符',
      db: client({ papers: [paper({ specification: '180g' })] }),
      request: input(),
      code: 'CATALOG_PAPER_CHANGED',
    },
  ])('对$label失败关闭', async ({ db, request, code }) => {
    const error = await adapterError(
      buildCreateOrderQuoteInputFromCatalog(db, request),
    );
    expect(error.code).toBe(code);
  });

  it('由服务端规格推导西封结构与中/大计价组', async () => {
    const items = [
      item({
        specification: '西封中号80×120',
        actualWidthMm: 80,
        actualHeightMm: 120,
        productId: 'product-west-mid',
        productStructure: OrderProductStructure.WESTERN_ENVELOPE,
      }),
      item({
        itemKey: 'style-2',
        fig: 2,
        specification: '西封大号85×165',
        actualWidthMm: 85,
        actualHeightMm: 165,
        productId: 'product-west-large',
        productStructure: OrderProductStructure.WESTERN_ENVELOPE,
      }),
    ];
    const result = await buildCreateOrderQuoteInputFromCatalog(
      client({
        products: [
          product({
            id: 'product-west-mid',
            code: 'WEST-MID',
            specification: '西封中号80×120',
          }),
          product({
            id: 'product-west-large',
            code: 'WEST-LARGE',
            specification: '西封大号85×165',
          }),
        ],
      }),
      input(items),
    );

    expect(result.items.map((candidate) => [
      candidate.productStructure,
      candidate.pricingGroup,
      candidate.specification,
    ])).toEqual([
      ['WESTERN_ENVELOPE', 'MID', '西封中号'],
      ['WESTERN_ENVELOPE', 'LARGE', '西封大号'],
    ]);
  });

  it('从彩印的颜色、局部标记、烫法与覆膜推导结构化字段', async () => {
    const printBase = {
      pricingRoute: OrderItemPricingRoute.COLOR_PRINT,
      productStructure: OrderProductStructure.STANDARD_ENVELOPE,
      paperType: '200g双铜纸',
      paperWeightGsm: 200,
      specification: '大号封90×165',
      actualWidthMm: 90,
      actualHeightMm: 165,
    } as const;
    const items = [
      item({
        ...printBase,
        productId: 'print-plain',
        crafts: ['craft-print'],
        frontFoilColors: [],
        foilColors: [],
        foilTechnique: OrderFoilTechnique.NONE,
        hasLocalFoil: false,
        lamination: OrderLamination.MATTE,
      }),
      item({
        ...printBase,
        itemKey: 'style-2',
        fig: 2,
        productId: 'print-local',
        crafts: ['craft-print-foil'],
        hasLocalFoil: true,
        lamination: OrderLamination.SOFT_TOUCH,
      }),
      item({
        ...printBase,
        itemKey: 'style-3',
        fig: 3,
        productId: 'print-full',
        crafts: ['craft-print-foil', 'craft-bump'],
        foilTechnique: OrderFoilTechnique.RAISED,
        hasLocalFoil: false,
        lamination: OrderLamination.LASER,
      }),
    ];
    const result = await buildCreateOrderQuoteInputFromCatalog(
      client({
        products: [
          product({
            id: 'print-plain',
            code: 'PRINT-PLAIN',
            category: 'COLOR_PRINT',
            paperType: '200g双铜纸',
            paperMaterialId: 'paper-coated-200',
            weight: 200,
          }),
          product({
            id: 'print-local',
            code: 'PRINT-LOCAL',
            category: 'COLOR_PRINT',
            paperType: '200g双铜纸',
            paperMaterialId: 'paper-coated-200',
            weight: 200,
          }),
          product({
            id: 'print-full',
            code: 'PRINT-FULL',
            category: 'COLOR_PRINT',
            paperType: '200g双铜纸',
            paperMaterialId: 'paper-coated-200',
            weight: 200,
          }),
        ],
        crafts: [
          craft({ id: 'craft-print', code: 'COATED_COLOR_PRINT' }),
          craft({ id: 'craft-print-foil', code: 'COATED_COLOR_PRINT_FOIL' }),
          craft({ id: 'craft-bump', code: 'BUMP' }),
        ],
        papers: [
          paper({
            id: 'paper-coated-200',
            name: '双铜纸',
            specification: '200g',
          }),
        ],
      }),
      input(items),
    );

    expect(result.items.map((candidate) => ({
      craft: candidate.craft,
      foil: candidate.printFoilMode,
      effect: candidate.specialEffect,
      finishing: candidate.printFinishing,
    }))).toEqual([
      { craft: 'PRINT', foil: 'NONE', effect: 'NONE', finishing: 'MATTE' },
      { craft: 'PRINT', foil: 'PARTIAL', effect: 'NONE', finishing: 'TACTILE' },
      { craft: 'PRINT', foil: 'FULL', effect: 'RAISED', finishing: 'LASER' },
    ]);
  });

  it('保留混装组成与发货分配，不接受 actualBagCount 或浏览器重量作为计价权威', async () => {
    const items = [
      item({ quantity: 1_000 }),
      item({ itemKey: 'style-2', fig: 2, quantity: 2_000 }),
    ];
    const request: CreateOrderQuoteFactsAdapterInput = {
      ...input(items),
      packagingGroups: [
        {
          groupKey: 'mixed-1',
          mode: 'MIXED_STYLE',
          actualBagCount: 999_999,
          items: [
            { itemKey: 'style-1', unitsPerBag: 1 },
            { itemKey: 'style-2', unitsPerBag: 2 },
          ],
        },
      ],
      shipments: [
        {
          shipmentKey: 'primary',
          province: '上海',
          browserBillableWeightKg: '9999',
          itemQuantities: { 'style-1': 700, 'style-2': 1_400 },
        },
        {
          shipmentKey: 'extra-1',
          province: '江苏',
          browserBillableWeightKg: '8888',
          trustedFulfilmentWeightKg: '12.500',
          itemQuantities: { 'style-1': 300, 'style-2': 600 },
        },
      ],
    };

    const result = await buildCreateOrderQuoteInputFromCatalog(
      client(),
      request,
    );

    expect(result.packagingGroups).toEqual([
      {
        groupKey: 'mixed-1',
        mode: 'MIXED_STYLE',
        items: [
          { itemKey: 'style-1', unitsPerBag: 1 },
          { itemKey: 'style-2', unitsPerBag: 2 },
        ],
      },
    ]);
    expect(result.shipments).toEqual([
      {
        shipmentKey: 'primary',
        province: '上海',
        trustedBillableWeightKg: null,
        itemQuantities: { 'style-1': 700, 'style-2': 1_400 },
      },
      {
        shipmentKey: 'extra-1',
        province: '江苏',
        trustedBillableWeightKg: '12.5',
        itemQuantities: { 'style-1': 300, 'style-2': 600 },
      },
    ]);
    expect(
      calculateCreateOrderQuote(result, CREATE_ORDER_GOLDEN_SNAPSHOT)
        .packagingGroups[0]?.bagCount,
    ).toBe(1_000);
  });

  it.each([
    {
      label: '包装组引用未知款式',
      groups: [
        {
          groupKey: 'bag-1',
          mode: 'SINGLE_STYLE' as const,
          items: [{ itemKey: 'missing', unitsPerBag: 10 }],
        },
      ],
    },
    {
      label: '同一款式进入多个包装组',
      groups: [
        {
          groupKey: 'bag-1',
          mode: 'SINGLE_STYLE' as const,
          items: [{ itemKey: 'style-1', unitsPerBag: 10 }],
        },
        {
          groupKey: 'bag-2',
          mode: 'SINGLE_STYLE' as const,
          items: [{ itemKey: 'style-1', unitsPerBag: 20 }],
        },
      ],
    },
  ])('拒绝$label', async ({ groups }) => {
    const error = await adapterError(
      buildCreateOrderQuoteInputFromCatalog(client(), {
        ...input(),
        packagingGroups: groups,
      }),
    );
    expect(error.code).toBe('INVALID_PACKAGING_FACTS');
  });
});

// Retirement is a new-business rule enforced in createOrder / the workbench.
// Change requests and cancellation settlement feed persisted 120g facts through
// this adapter, so it must keep repricing them.
it.each([undefined, '管理员核价'])('keeps repricing persisted 120g facts, including manual pricing (%s)', async (manualQuoteReason) => {
  const request = input([item({ paperType: '120g珠光艳闪', paperWeightGsm: 120, manualQuoteReason })]);
  const result = await buildCreateOrderQuoteInputFromCatalog(client({
    products: [product({ paperType: '120g珠光艳闪', paperMaterialId: null, weight: 120 })],
    papers: [paper({ id: 'paper-pearl-120', specification: '120g' })],
  }), request);
  expect(result.items[0]).toMatchObject({ itemKey: 'style-1', paperWeightGsm: 120 });
});
