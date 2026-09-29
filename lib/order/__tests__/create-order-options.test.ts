import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CREATE_ORDER_GOLDEN_SNAPSHOT } from '../../price/__tests__/fixtures/create-order-golden-fixtures';
import {
  MaterialCategory,
  OrderProductStructure,
  ProductCategory,
} from '../../../generated/prisma/enums';

const { dbMock, txMock, readSnapshotMock } = vi.hoisted(() => {
  const tx = {
    $executeRaw: vi.fn(),
    material: { findMany: vi.fn() },
    product: { findMany: vi.fn() },
  };
  return {
    txMock: tx,
    readSnapshotMock: vi.fn(),
    dbMock: {
      $transaction: vi.fn(
        async (callback: (client: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
    },
  };
});

vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('server-only', () => ({}));
vi.mock('../create-order-published-rule-adapter', () => ({
  readPublishedCreateOrderPriceSnapshot: readSnapshotMock,
}));

import {
  listExternalCreateOrderOptions,
  readExternalCreateOrderOptions,
} from '../create-order-options';
import { assertBlankPriceAdmissionInTx } from '../blank-price-admission';

const products = [
  {
    id: 'product-stock',
    code: 'PRODUCT-STOCK',
    name: '局部烫金现货',
    category: ProductCategory.BLANK_STOCK,
    specification: '西封中号80×120 / 西封大号85×165',
    paperType: '160g珠光艳闪',
    paperMaterialId: 'paper-flash',
    weight: 160,
    categoryNode: {
      path: 'product.blank_stock',
      legacyCategory: ProductCategory.BLANK_STOCK,
    },
  },
  {
    id: 'product-unpriced-full',
    code: 'PRODUCT-UNPRICED-FULL',
    name: '合法但尚无自动价格的专版 SKU',
    category: ProductCategory.CUSTOM_FLAT_FOIL,
    specification: '大号90×165',
    paperType: null,
    paperMaterialId: null,
    weight: null,
    categoryNode: {
      path: 'product.custom_flat_foil',
      legacyCategory: ProductCategory.CUSTOM_FLAT_FOIL,
    },
  },
] as const;

const papers = [
  {
    id: 'paper-flash',
    code: 'PAPER-FLASH-160',
    name: '珠光艳闪',
    specification: '160g',
    unit: '张',
    outOfStock: true,
    sortOrder: 10,
  },
  {
    id: 'paper-custom',
    code: 'PAPER-CUSTOM',
    name: '客户自定义纸张',
    specification: null,
    unit: '张',
    outOfStock: false,
    sortOrder: 20,
  },
] as const;

const foilColors = [
  {
    id: 'foil-matte-gold',
    code: 'FOIL-MATTE-GOLD',
    name: '亚金',
    displayColor: '#BE982D',
    displayImage: '/images/order/foil/matte-gold.png',
    sortOrder: 10,
  },
] as const;

function paperRowsForQuery(where: { isActive?: boolean }, rows: readonly typeof papers[number][] = papers) {
  return where.isActive === undefined ? rows.map((paper) => ({ ...paper, isActive: true })) : rows;
}

beforeEach(() => {
  vi.clearAllMocks();
  readSnapshotMock.mockResolvedValue({ ...CREATE_ORDER_GOLDEN_SNAPSHOT,
    partial: { ...CREATE_ORDER_GOLDEN_SNAPSHOT.partial, blankUnitPrices: [
      { paperType: '珠光艳闪', paperWeightGsm: 160, specification: '西封中号', unitPrice: '0.12' },
      { paperType: '珠光艳闪', paperWeightGsm: 160, specification: '西封大号', unitPrice: '0.12' },
    ] },
  });
  txMock.$executeRaw.mockResolvedValue(0);
  txMock.product.findMany.mockResolvedValue(products);
  txMock.material.findMany.mockImplementation(
    async (args: { where: { category: MaterialCategory; isActive?: boolean } }) =>
      args.where.category === MaterialCategory.PAPER ? paperRowsForQuery(args.where) : foilColors,
  );
});

describe('external create-order options', () => {
  it('omits ambiguous blank identities even when the duplicate paper is inactive', async () => {
    const allPapers = [
      { ...papers[0], isActive: true, outOfStock: false },
      { ...papers[0], id: 'inactive-duplicate', code: 'INACTIVE-DUPLICATE',
        name: '160g珠光艳闪', isActive: false, outOfStock: false },
    ];
    txMock.material.findMany.mockImplementation(async (args: {
      where: { category: MaterialCategory; isActive?: boolean };
    }) => args.where.category === MaterialCategory.PAPER
      ? allPapers.filter((paper) => args.where.isActive === undefined || paper.isActive === args.where.isActive)
      : foilColors);
    const result = await readExternalCreateOrderOptions(txMock as never);
    await expect(assertBlankPriceAdmissionInTx(txMock as never, [{
      pricingRoute: 'STOCK_BLANK', paperType: '珠光艳闪', paperWeightGsm: 160,
      specification: '西封中号80×120',
    }], new Date())).rejects.toThrow('资料不唯一');
    expect(result.products.filter((product) => product.category === ProductCategory.BLANK_STOCK)).toEqual([]);
    expect(result.products.map((product) => product.id)).toContain('product-unpriced-full');
    expect(result.papers.map((paper) => paper.id)).toEqual(['paper-flash']);
  });

  it('derives blank selections from published prices without Product IDs and keeps nonblank products', async () => {
    const result = await readExternalCreateOrderOptions(txMock as never);

    expect(result.products.map((product) => product.id)).toEqual([
      'product-unpriced-full',
      null,
      null,
    ]);
    expect(txMock.product.findMany).toHaveBeenCalledWith({
      where: {
        isActive: true,
        category: {
          in: [
            ProductCategory.CUSTOM_FLAT_FOIL,
            ProductCategory.COLOR_PRINT,
          ],
        },
        categoryNode: { is: { isActive: true } },
      },
      select: expect.objectContaining({
        specification: true,
        paperMaterialId: true,
        weight: true,
      }),
      orderBy: [{ category: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    });
    expect(txMock.$executeRaw).toHaveBeenCalledOnce();
  });

  it('keeps out-of-stock and unresolved paper facts explicit and reads FOIL display metadata', async () => {
    const result = await readExternalCreateOrderOptions(txMock as never);

    expect(result.papers).toEqual([
      { ...papers[0], weight: 160 },
      { ...papers[1], weight: null },
    ]);
    expect(result.foilColors).toEqual(foilColors);
    expect(txMock.material.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { category: MaterialCategory.PAPER, isActive: true },
        select: expect.objectContaining({ outOfStock: true, sortOrder: true }),
      }),
    );
    expect(txMock.material.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { category: MaterialCategory.FOIL, isActive: true },
        select: expect.objectContaining({
          displayColor: true,
          displayImage: true,
          sortOrder: true,
        }),
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      }),
    );
  });

  it('fails closed when the active FOIL catalog is empty', async () => {
    txMock.material.findMany.mockImplementation(
      async (args: { where: { category: MaterialCategory; isActive?: boolean } }) =>
        args.where.category === MaterialCategory.PAPER ? paperRowsForQuery(args.where) : [],
    );

    await expect(
      readExternalCreateOrderOptions(txMock as never),
    ).rejects.toMatchObject({
      name: 'ExternalCreateOrderOptionsError',
      code: 'MISSING_REQUIRED_CONFIG',
    });
  });

  it('projects legacy matte-gold stock and the standard swatch as one order color', async () => {
    const legacy = { id: 'legacy-stock', code: 'MAT-000001', name: '哑金',
      displayColor: null, displayImage: null, sortOrder: 0 };
    const standard = { id: 'mat_foil_matte_gold', code: 'FOIL-MATTE-GOLD', name: '亚金',
      displayColor: 'gold', displayImage: '/images/order/foil/matte-gold.png', sortOrder: 10 };
    const materials = [legacy, standard];
    txMock.material.findMany.mockImplementation(
      async (args: { where: { category: MaterialCategory; isActive?: boolean } }) =>
        args.where.category === MaterialCategory.PAPER ? paperRowsForQuery(args.where) : materials,
    );
    const result = await readExternalCreateOrderOptions(txMock as never);
    expect(result.foilColors).toEqual([standard]);
    expect(materials).toEqual([legacy, standard]);
  });

  it('returns configured FOIL names and display colors without substituting defaults', async () => {
    const configuredFoilColors = [
      {
        id: 'foil-configured-purple',
        code: 'FOIL-CONFIGURED-PURPLE',
        name: '配置紫',
        displayColor: '#6543C1',
        displayImage: '/images/order/foil/configured-purple.png',
        sortOrder: 7,
      },
    ] as const;
    txMock.material.findMany.mockImplementation(
      async (args: { where: { category: MaterialCategory; isActive?: boolean } }) =>
        args.where.category === MaterialCategory.PAPER
          ? paperRowsForQuery(args.where)
          : configuredFoilColors,
    );

    const result = await readExternalCreateOrderOptions(txMock as never);

    expect(result.foilColors).toEqual(configuredFoilColors);
    expect(result.foilColors[0]).toMatchObject({
      name: '配置紫',
      displayColor: '#6543C1',
      displayImage: '/images/order/foil/configured-purple.png',
    });
  });

  it('derives blank dimensions from standard specifications and other dimensions from products', async () => {
    const result = await readExternalCreateOrderOptions(txMock as never);

    expect(result.specifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          specCode: '西封中号80×120',
          label: '西封中号80×120',
          widthMm: 80,
          heightMm: 120,
          productStructure: OrderProductStructure.WESTERN_ENVELOPE,
          productIds: [],
        }),
        expect.objectContaining({
          specCode: '西封大号85×165',
          label: '西封大号85×165',
          widthMm: 85,
          heightMm: 165,
          productStructure: OrderProductStructure.WESTERN_ENVELOPE,
          productIds: [],
        }),
      ]),
    );
  });

  it('does not expose a specification that the authoritative adapter cannot canonicalize', async () => {
    txMock.product.findMany.mockResolvedValue([
      ...products,
      {
        ...products[1],
        id: 'legacy-malformed-spec',
        code: 'PRD-000002',
        specification: '100×200,中号',
        paperType: '珠光纸',
      },
    ]);

    const result = await readExternalCreateOrderOptions(txMock as never);

    expect(result.products.map((product) => product.code)).toContain(
      'PRD-000002',
    );
    expect(result.specifications.map((option) => option.label)).not.toContain(
      '100×200,中号',
    );
  });

  it('fails closed if case-insensitive option codes are duplicated', async () => {
    txMock.product.findMany.mockResolvedValue([
      products[1],
      {
        ...products[1],
        id: 'duplicate-product',
        code: 'product-unpriced-full',
      },
    ]);

    await expect(
      readExternalCreateOrderOptions(txMock as never),
    ).rejects.toMatchObject({
      code: 'DUPLICATE_CODE',
    });
  });

  it('standalone loader owns a transaction while composed readers may reuse an existing lock', async () => {
    await listExternalCreateOrderOptions();
    expect(dbMock.$transaction).toHaveBeenCalledOnce();

    vi.clearAllMocks();
    txMock.product.findMany.mockResolvedValue(products);
    txMock.material.findMany.mockImplementation(
      async (args: { where: { category: MaterialCategory; isActive?: boolean } }) =>
        args.where.category === MaterialCategory.PAPER ? paperRowsForQuery(args.where) : foilColors,
    );
    await readExternalCreateOrderOptions(txMock as never, {
      snapshotLockHeld: true,
    });
    expect(txMock.$executeRaw).not.toHaveBeenCalled();
  });
});

it('removes retired 120g products and materials from the shared admin/sales catalog', async () => {
  txMock.product.findMany.mockResolvedValue([...products, { ...products[0], id: 'retired-product', code: 'RETIRED', paperType: '120g珠光艳闪', weight: null, paperMaterialId: null }]);
  txMock.material.findMany.mockImplementation(async (args: { where: { category: MaterialCategory; isActive?: boolean } }) => args.where.category === MaterialCategory.PAPER ? [...paperRowsForQuery(args.where), { ...papers[0], id: 'retired-paper', code: 'RETIRED-PAPER', name: '120G 珠光艳闪', specification: '', isActive: true }] : foilColors);
  const result = await readExternalCreateOrderOptions(txMock as never);
  expect(result.products.some(row => row.id === 'retired-product')).toBe(false);
  expect(result.papers.some(row => row.id === 'retired-paper')).toBe(false);
});
