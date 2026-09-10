import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@/generated/prisma/enums';
import { CREATE_ORDER_GOLDEN_SNAPSHOT } from '@/lib/price/__tests__/fixtures/create-order-golden-fixtures';
import { CreateOrderQuoteError } from '@/lib/order/create-order-quote-service';

const mocks = vi.hoisted(() => ({
  permission: vi.fn(),
  options: vi.fn(),
  crafts: vi.fn(),
  transaction: vi.fn(),
  snapshot: vi.fn(),
  products: vi.fn(),
  materials: vi.fn(),
  catalogCrafts: vi.fn(),
}));
vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: mocks.permission,
}));
vi.mock('@/lib/order/create-order-options', () => ({
  listExternalCreateOrderOptions: mocks.options,
}));
vi.mock('@/lib/craft', () => ({ listActiveCraftOrderOptions: mocks.crafts }));
vi.mock('@/lib/db', () => ({ db: { $transaction: mocks.transaction } }));
vi.mock(
  '@/lib/order/create-order-published-rule-adapter',
  async (original) => ({
    ...(await original<object>()),
    readPublishedCreateOrderPriceSnapshot: mocks.snapshot,
  }),
);

import { quoteWorkbenchAction } from '../workbench';
const product = {
  id: 'product-stock',
  code: null,
  name: '大号局部烫金',
  category: 'BLANK_STOCK',
  specification: '大号封90×165',
  paperType: '160g珠光艳闪',
  paperMaterialId: null,
  weight: 160,
  isActive: true,
};
const craft = {
  id: 'craft-partial',
  code: 'FLAT_FOIL_PARTIAL',
  name: '局部烫金',
  isActive: true,
};
const tx = {
  product: { findMany: mocks.products },
  material: { findMany: mocks.materials },
  craft: { findMany: mocks.catalogCrafts },
};
const input = {
  productId: product.id,
  pricingRoute: 'STOCK_BLANK',
  specification: product.specification,
  paperType: product.paperType,
  quantity: 1000,
  foilTechnique: 'FLAT',
  frontFoilColors: ['哑金'],
  backFoilColors: [],
  markup: 35,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.permission.mockResolvedValue({ id: 'sales', role: Role.SALES });
  mocks.options.mockResolvedValue({
    products: [product],
    foilColors: [{ name: '哑金' }, { name: '红金' }],
  });
  mocks.crafts.mockResolvedValue([craft]);
  mocks.transaction.mockImplementation((run) => run(tx));
  mocks.snapshot.mockResolvedValue(CREATE_ORDER_GOLDEN_SNAPSHOT);
  mocks.products.mockResolvedValue([product]);
  mocks.catalogCrafts.mockResolvedValue([craft]);
  mocks.materials.mockResolvedValue([
    {
      id: 'paper',
      name: '160g珠光艳闪',
      specification: null,
      isActive: true,
      outOfStock: false,
    },
  ]);
});

function useFoilCatalog(category: 'CUSTOM_FLAT_FOIL' | 'COLOR_PRINT') {
  const print = category === 'COLOR_PRINT';
  const currentProduct = {
    ...product,
    category,
    paperType: print ? '200g铜版纸' : product.paperType,
    weight: print ? 200 : 160,
  };
  const currentCrafts = (
    print
      ? ['COATED_COLOR_PRINT_FOIL']
      : ['FLAT_FOIL_SINGLE', 'FLAT_FOIL_DOUBLE', 'FLAT_FOIL_TRIPLE']
  ).map((code) => ({ ...craft, id: code, code }));
  const paper = {
    id: 'paper',
    name: currentProduct.paperType,
    specification: null,
    isActive: true,
    outOfStock: false,
  };
  mocks.options.mockResolvedValue({
    products: [currentProduct],
    papers: [paper],
    foilColors: ['哑金', '红金', '银'].map((name) => ({ name })),
  });
  mocks.products.mockResolvedValue([currentProduct]);
  mocks.materials.mockResolvedValue([paper]);
  mocks.crafts.mockResolvedValue(currentCrafts);
  mocks.catalogCrafts.mockResolvedValue(currentCrafts);
  return {
    ...input,
    paperType: currentProduct.paperType,
    pricingRoute: print ? 'COLOR_PRINT' : 'CUSTOM_SINGLE_FLAT_FOIL',
  };
}

describe('workbench current-price quote', () => {
  it.each([Role.SALES, Role.CUSTOMER_SERVICE, Role.ADMIN])(
    'uses the real published pricing engine for %s and returns a minimal projection',
    async (role) => {
      mocks.permission.mockResolvedValue({ id: 'u', role });
      const result = await quoteWorkbenchAction({
        ...input,
        baseAmount: '0.01',
        internalCost: '1',
      });
      expect(mocks.permission).toHaveBeenCalledWith('order:create');
      expect(result).toMatchObject({
        status: 'success',
        quote: {
          baseAmount: '170.00',
          suggestedAmount: '229.50',
          markupAmount: '59.50',
          needsPricing: false,
        },
      });
      expect(JSON.stringify(result)).not.toMatch(
        /sourceSha256|sourceSheet|snapshot|quoteToken|internalCost|ruleCode/,
      );
    },
  );
  it('denies unauthorized users before reading any catalog', async () => {
    mocks.permission.mockRejectedValue(new Error('unauthorized'));
    await expect(quoteWorkbenchAction(input)).rejects.toThrow('unauthorized');
    expect(mocks.options).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it.each([
    { quantity: -1 },
    { quantity: 1.2 },
    { markup: -1 },
    { markup: 101 },
    { frontFoilColors: ['a', 'b', 'c', 'd'] },
  ])('rejects invalid input %j', async (invalid) => {
    expect(await quoteWorkbenchAction({ ...input, ...invalid })).toMatchObject({
      status: 'error',
    });
    expect(mocks.options).not.toHaveBeenCalled();
  });
  it.each([
    { productId: 'gone' },
    { specification: '不存在' },
    { paperType: '伪造纸张' },
    { frontFoilColors: ['未配置'] },
    { pricingRoute: 'COLOR_PRINT' },
  ])('rejects catalog mismatch %j', async (invalid) => {
    expect(await quoteWorkbenchAction({ ...input, ...invalid })).toMatchObject({
      status: 'error',
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('counts front and back passes independently', async () => {
    expect(
      await quoteWorkbenchAction({ ...input, backFoilColors: ['哑金'] }),
    ).toMatchObject({
      status: 'success',
      quote: { baseAmount: '210.00', suggestedAmount: '283.50' },
    });
  });
  it('revalidates catalog facts inside the engine transaction', async () => {
    mocks.products.mockResolvedValue([]);
    expect(await quoteWorkbenchAction(input)).toMatchObject({
      status: 'error',
    });
  });
  it('fails closed when published prices cannot be read', async () => {
    mocks.snapshot.mockRejectedValue(
      new Error('private database connection details'),
    );
    const result = await quoteWorkbenchAction(input);
    expect(result).toMatchObject({ status: 'error' });
    expect(JSON.stringify(result)).not.toContain('private database');
  });
  it('does not present known fee lines as a complete quote when base pricing is missing', async () => {
    mocks.snapshot.mockResolvedValue({
      ...CREATE_ORDER_GOLDEN_SNAPSHOT,
      partial: { ...CREATE_ORDER_GOLDEN_SNAPSHOT.partial, blankUnitPrices: [] },
    });
    expect(await quoteWorkbenchAction(input)).toMatchObject({
      status: 'success',
      quote: {
        needsPricing: true,
        baseAmount: null,
        suggestedAmount: null,
        markupAmount: null,
      },
    });
  });
  it('quotes size-only custom products using the current paper material catalog', async () => {
    const custom = {
      ...product,
      category: 'CUSTOM_FLAT_FOIL',
      paperType: null,
      weight: null,
    };
    const paper = {
      id: 'paper',
      name: '珠光艳闪',
      weight: 160,
      specification: '160g',
      outOfStock: false,
      isActive: true,
    };
    const customCraft = { ...craft, code: 'FLAT_FOIL_SINGLE' };
    mocks.options.mockResolvedValue({
      products: [custom],
      papers: [paper],
      foilColors: [{ name: '哑金' }],
    });
    mocks.products.mockResolvedValue([custom]);
    mocks.materials.mockResolvedValue([paper]);
    mocks.crafts.mockResolvedValue([customCraft]);
    mocks.catalogCrafts.mockResolvedValue([customCraft]);
    const result = await quoteWorkbenchAction({
      ...input,
      pricingRoute: 'CUSTOM_SINGLE_FLAT_FOIL',
    });
    expect(result).toMatchObject({
      status: 'success',
      quote: { needsPricing: false },
    });
    if (result.status === 'success')
      expect(result.quote.baseAmount).not.toBeNull();
  });
  it('quotes pure color print without inventing per-piece multiplication for a per-order fee', async () => {
    const printProduct = {
      ...product,
      category: 'COLOR_PRINT',
      paperType: '200g铜版纸',
      weight: 200,
      paperMaterialId: 'paper',
    };
    const paper = {
      id: 'paper',
      name: '铜版纸',
      specification: '200g',
      weight: 200,
      outOfStock: false,
      isActive: true,
    };
    const printCraft = { ...craft, code: 'COATED_COLOR_PRINT' };
    mocks.options.mockResolvedValue({
      products: [printProduct],
      papers: [paper],
      foilColors: [],
    });
    mocks.products.mockResolvedValue([printProduct]);
    mocks.materials.mockResolvedValue([paper]);
    mocks.crafts.mockResolvedValue([printCraft]);
    mocks.catalogCrafts.mockResolvedValue([printCraft]);
    const result = await quoteWorkbenchAction({
      ...input,
      paperType: '200g铜版纸',
      pricingRoute: 'COLOR_PRINT',
      quantity: 2000,
      frontFoilColors: [],
      foilTechnique: 'NONE',
    });
    expect(result).toMatchObject({
      status: 'success',
      quote: { needsPricing: false },
    });
    if (result.status === 'success') {
      expect(result.quote.lines[0]?.units).toBe('1');
      expect(result.quote.lines[0]?.rate).toBe(result.quote.lines[0]?.amount);
    }
  });
});

it('identifies missing catalog paper weight without guessing a price', async () => {
  mocks.options.mockResolvedValue({
    products: [{ ...product, paperType: '珠光纸', weight: null }],
    papers: [],
    foilColors: [{ name: '哑金' }],
  });
  expect(await quoteWorkbenchAction({ ...input, paperType: '珠光纸' })).toEqual(
    {
      status: 'error',
      message: '所选纸张缺少克重，请联系管理员补充产品资料后再计算',
    },
  );
  expect(mocks.transaction).not.toHaveBeenCalled();
});

describe('workbench automatic quote failure guidance', () => {
  it('does not return an unrecognized engine message alongside approved guidance', async () => {
    mocks.snapshot.mockRejectedValue(
      new CreateOrderQuoteError(
        '款式 1：专版烫金只能使用正面；private database details',
      ),
    );
    expect(await quoteWorkbenchAction(input)).toEqual({
      status: 'error',
      message: '暂无法取得当前报价，请重试；仍无法计算时请联系管理员核价',
    });
  });
  it('explains a back-only partial foil quote after consulting the real engine', async () => {
    const result = await quoteWorkbenchAction({
      ...input,
      frontFoilColors: [],
      backFoilColors: ['哑金'],
    });
    expect(mocks.snapshot).toHaveBeenCalled();
    expect(result).toEqual({
      status: 'error',
      message: '请至少选择一种正面烫金颜色后自动计算',
    });
  });
  it.each(['CUSTOM_FLAT_FOIL', 'COLOR_PRINT'] as const)(
    'explains the current %s reverse-side limitation without rejecting production facts in the schema',
    async (category) => {
      const currentInput = useFoilCatalog(category);
      const result = await quoteWorkbenchAction({
        ...currentInput,
        backFoilColors: ['哑金'],
      });
      expect(mocks.snapshot).toHaveBeenCalled();
      expect(result).toEqual({
        status: 'error',
        message:
          category === 'COLOR_PRINT'
            ? '彩印加反面烫金暂不支持自动报价；如需反面烫金，请联系管理员核价'
            : '专版反面烫金暂不支持自动报价；如需反面烫金，请联系管理员核价',
      });
    },
  );
  it('explains both missing front color and unsupported reverse-side full foil', async () => {
    const result = await quoteWorkbenchAction({
      ...useFoilCatalog('CUSTOM_FLAT_FOIL'),
      frontFoilColors: [],
      backFoilColors: ['哑金'],
    });
    expect(result).toEqual({
      status: 'error',
      message:
        '请至少选择一种正面烫金颜色后自动计算；专版反面烫金暂不支持自动报价；如需反面烫金，请联系管理员核价',
    });
  });
  it.each(['100×200、中号', '特大封120×200'])(
    'identifies unpriceable catalog specification %s without returning internal item facts',
    async (specification) => {
      const configuredProduct = { ...product, specification };
      mocks.options.mockResolvedValue({
        products: [configuredProduct],
        foilColors: [{ name: '哑金' }],
      });
      mocks.products.mockResolvedValue([configuredProduct]);
      expect(await quoteWorkbenchAction({ ...input, specification })).toEqual({
        status: 'error',
        message: '所选规格无法自动报价，请选择其他规格或联系管理员补充产品资料',
      });
    },
  );
  it('shows why a three-color full foil quote requires manual pricing', async () => {
    expect(
      await quoteWorkbenchAction({
        ...useFoilCatalog('CUSTOM_FLAT_FOIL'),
        frontFoilColors: ['哑金', '红金', '银'],
      }),
    ).toMatchObject({
      status: 'success',
      quote: {
        baseAmount: null,
        suggestedAmount: null,
        needsPricing: true,
        pricingReasons: ['专版烫金三色及以上需要管理员核价'],
      },
    });
  });
  it('explains missing paper pricing while keeping the complete amount unknown', async () => {
    const currentInput = useFoilCatalog('CUSTOM_FLAT_FOIL');
    mocks.snapshot.mockResolvedValue({
      ...CREATE_ORDER_GOLDEN_SNAPSHOT,
      full: {
        ...CREATE_ORDER_GOLDEN_SNAPSHOT.full,
        basePapers: [],
        paperSurcharges: [],
      },
    });
    expect(await quoteWorkbenchAction(currentInput)).toMatchObject({
      status: 'success',
      quote: {
        suggestedAmount: null,
        markupAmount: null,
        needsPricing: true,
        pricingReasons: [
          '所选纸张暂无专版烫金价格，请选择其他纸张或联系管理员核价',
        ],
      },
    });
  });
  it('does not show stale manual pricing guidance after a complete quote', async () => {
    expect(await quoteWorkbenchAction(input)).toMatchObject({
      status: 'success',
      quote: { needsPricing: false, pricingReasons: [] },
    });
  });
});
