import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OrderFoilTechnique,
  DesignFileType,
  OrderItemPricingRoute,
  OrderLamination,
  OrderPackagingMode,
  OrderProductStructure,
} from '@/generated/prisma/enums';
import type { CreateOrderInput } from '@/lib/auth/schemas';
import type { PendingDesignImage } from '../pending-design-image';
import {
  OrderFormB,
  parseExternalReceiverDisplay,
  replacePendingDesignKind,
} from '../order-form-b/ExternalSalesOrderFormB';

type RecordedButtonProps = {
  children?: unknown;
  onClick?: (event: unknown) => void;
  'aria-label'?: string;
};

const recordedButtonProps = vi.hoisted(
  () => [] as RecordedButtonProps[],
);

vi.mock('@/components/ui/button', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui/button')>();
  const { createElement } = await import('react');
  return {
    ...actual,
    Button: (props: Parameters<typeof actual.Button>[0]) => {
      recordedButtonProps.push(props as RecordedButtonProps);
      return createElement(actual.Button, props);
    },
  };
});

vi.mock('../design-upload-client', () => ({
  prepareDesignFile: vi.fn(),
}));

function item(
  pricingRoute: OrderItemPricingRoute,
): CreateOrderInput['items'][number] {
  return {
    name: '局部烫金 · 触感纸 200g · 大号封',
    productId: 'product-1',
    pricingRoute,
    productStructure: OrderProductStructure.STANDARD_ENVELOPE,
    artworkVersion: null,
    plateGroupId: null,
    pricingGroup: null,
    manualQuoteReason: null,
    specification: '大号封',
    actualWidthMm: 90,
    actualHeightMm: 165,
    paperType: '触感纸',
    paperWeightGsm: 200,
    quantity: 2000,
    crafts: ['craft-1'],
    frontFoilColors: ['亚金'],
    backFoilColors: [],
    foilColors: ['亚金'],
    foilTechnique: OrderFoilTechnique.FLAT,
    hasLocalFoil: true,
    lamination: OrderLamination.NONE,
    printColors: [],
    isDoubleSided: false,
    isDoubleColor: false,
    unitPrice: null,
    fixedFee: null,
    suggestedSubtotal: null,
    priceOverrideReason: null,
    remark: null,
  };
}

function render(
  activeItem: CreateOrderInput['items'][number] = item(
    OrderItemPricingRoute.STOCK_BLANK,
  ),
  options: {
    paperKey?: string;
    itemCount?: number;
    activeIndex?: number;
    pendingDesigns?: Readonly<Record<string, PendingDesignImage[]>>;
    receiverAddress?: string;
    receiverPhoneRequired?: boolean;
    onRemove?: (index: number) => void;
    onFoilSidesChange?: (front: string[], back: string[]) => void;
  } = {},
) {
  const itemCount = options.itemCount ?? 1;
  const items = Array.from({ length: itemCount }, () => ({ ...activeItem }));
  return renderToStaticMarkup(
    <OrderFormB
      values={{
        customName: '',
        receiverName: '',
        receiverPhone: '',
        receiverAddress: options.receiverAddress ?? '',
        isSfCollect: false,
      }}
      items={items}
      itemFields={items.map((_, index) => ({ id: `style-${index + 1}` }))}
      activeIndex={options.activeIndex ?? 0}
      pendingDesigns={options.pendingDesigns ?? {}}
      packaging={{
        mode: OrderPackagingMode.SINGLE_STYLE,
        unitsPerBag: 10,
        bagCount: 200,
      }}
      paperOptions={[
        { value: 'touch', label: '触感纸', texture: 'matte-red' },
        { value: 'tbz', label: '铜版纸', texture: 'coated-white' },
      ]}
      paperKey={options.paperKey ?? 'touch'}
      weightOptions={[160, 200]}
      specificationOptions={[
        { value: '中号封', label: '中号封' },
        { value: '大号封', label: '大号封' },
      ]}
      savedLabel="已自动保存 10:30:00"
      receiverPhoneRequired={options.receiverPhoneRequired}
      rail={<div data-testid="price-rail">价格面板</div>}
      onActiveIndexChange={vi.fn()}
      onAdd={vi.fn()}
      onDuplicate={vi.fn()}
      onRemove={options.onRemove ?? vi.fn()}
      onCustomNameChange={vi.fn()}
      onRouteChange={vi.fn()}
      onPaperChange={vi.fn()}
      onWeightChange={vi.fn()}
      onSpecificationChange={vi.fn()}
      onFoilSidesChange={options.onFoilSidesChange ?? vi.fn()}
      onBackFoilToggle={vi.fn()}
      onFoilTechniqueChange={vi.fn()}
      onCustomSizeChange={vi.fn()}
      onPrintFoilModeChange={vi.fn()}
      onLaminationChange={vi.fn()}
      onQuantityChange={vi.fn()}
      onPackagingModeChange={vi.fn()}
      onUnitsPerBagChange={vi.fn()}
      onPendingDesignsChange={vi.fn()}
      onReceiverAddressChange={vi.fn()}
      onReceiverNameChange={vi.fn()}
      onReceiverPhoneChange={vi.fn()}
      onSfCollectChange={vi.fn()}
    />,
  );
}

describe('OrderFormB', () => {
  beforeEach(() => {
    recordedButtonProps.length = 0;
  });

  it('shows a cleaned address and keeps the platform code separate', () => {
    expect(
      parseExternalReceiverDisplay(
        '张三 13800138000  广东省佛山市南海区测试路 1 号 [TB-88]',
      ),
    ).toEqual({
      address: '广东省佛山市南海区测试路 1 号',
      platformCode: '[TB-88]',
      receiverName: '张三',
      receiverPhone: '13800138000',
    });
  });

  it('shows parsed receiver facts when the controlled form values are empty', () => {
    const html = render(undefined, {
      receiverAddress:
        '张三 13800138000 广东省佛山市南海区测试路1号 [TB-88]',
    });

    expect(html).toContain('value="张三"');
    expect(html).toContain('value="13800138000"');
    expect(html).toContain('广东省佛山市南海区测试路1号');
    expect(html).toContain('[TB-88]');
  });

  it('replaces only the chosen design-file kind', () => {
    const pending = (
      id: string,
      fileType: DesignFileType,
    ): PendingDesignImage => ({
      id,
      prepared: {
        file: { name: `${id}.test`, size: 1024 } as File,
        fileType,
        mimeType: 'application/octet-stream',
      },
    });
    const image = pending('image-old', DesignFileType.IMAGE);
    const cdr = pending('cdr', DesignFileType.CDR);
    const replacement = pending('image-new', DesignFileType.IMAGE);

    expect(
      replacePendingDesignKind(
        [image, cdr],
        DesignFileType.IMAGE,
        replacement,
      ).map((entry) => entry.id),
    ).toEqual(['cdr', 'image-new']);
    expect(
      replacePendingDesignKind(
        [image, cdr],
        DesignFileType.CDR,
        null,
      ).map((entry) => entry.id),
    ).toEqual(['image-old']);
  });

  it('matches the B single-page information hierarchy without the retired fields', () => {
    const html = render();

    expect(html).toContain('data-slot="order-form-b"');
    expect(html).toContain('新建工单');
    expect(html).not.toContain(
      '一款的全部字段一屏展开，右侧价格实时跟着变。熟练销售录单最快，桌面优先。',
    );
    for (const heading of [
      '工单',
      '工艺 · 第 1 款',
      '材料',
      '数量与包装',
      '文件',
      '收货',
    ]) {
      expect(html).toContain(`aria-label="${heading}"`);
    }
    expect(html).toContain('局部烫金');
    expect(html).toContain('专版烫金');
    expect(html).toContain('彩印');
    expect(html).toContain('＋ 加款');
    expect(html).toContain('⧉ 复制当前');
    expect(html).toContain('已自动保存 10:30:00');
    expect(html).toContain('价格面板');
    expect(html).toContain(
      'min-[881px]:grid-cols-[minmax(0,1fr)_310px]',
    );

    for (const retiredText of [
      '客户主数据',
      '客户名称/简称',
      '交期',
      '工单备注',
      '报价产品',
      '产品编码',
    ]) {
      expect(html).not.toContain(retiredText);
    }
    for (const internalCode of [
      'STOCK_BLANK',
      'CUSTOM_SINGLE_FLAT_FOIL',
      'COLOR_PRINT',
    ]) {
      expect(html).not.toMatch(new RegExp(`>${internalCode}<`));
    }
  });

  it('separates required artwork from optional CDR and keeps receiver facts editable', () => {
    const html = render(undefined, {
      receiverAddress: '广东省佛山市测试路 1 号',
    });

    expect(html).toContain('粘贴或上传设计图');
    expect(html).toContain('上传 CDR 文件');
    expect(html).not.toContain('data-slot="design-file-marker"');
    expect(html).not.toMatch(/>图</);
    expect(html).toContain('粘贴、拖放或选择第 1 款 设计图');
    expect(html).toContain('拖放或选择第 1 款 CDR 文件');
    expect(html).toMatch(/id="[^\"]*custom-name"[^>]*required=""/);
    expect(html).toMatch(/id="[^\"]*quantity"[^>]*required=""/);
    expect(html).not.toMatch(/id="[^\"]*receiver-name"[^>]*required=""/);
    expect(html).toMatch(/id="[^\"]*receiver-phone"[^>]*required=""/);
    expect(html).toContain('顺丰到付（本单不计快递费）');
  });

  it('allows internal settlement to make the receiver phone optional', () => {
    const html = render(undefined, {
      receiverAddress: '广东省佛山市测试路 1 号',
      receiverPhoneRequired: false,
    });

    expect(html).not.toMatch(/id="[^\"]*receiver-phone"[^>]*required=""/);
    expect(html).not.toMatch(
      /id="[^\"]*receiver-phone"[^>]*aria-required="true"/,
    );
  });

  it('shows real image preview markup and a compact CDR marker after upload', () => {
    const pending = (
      id: string,
      fileType: DesignFileType,
      fileName: string,
    ): PendingDesignImage => ({
      id,
      prepared: {
        file: { name: fileName, size: 1024 } as File,
        fileType,
        mimeType:
          fileType === DesignFileType.IMAGE
            ? 'image/png'
            : 'application/octet-stream',
      },
    });
    const html = render(undefined, {
      pendingDesigns: {
        'style-1': [
          pending('image', DesignFileType.IMAGE, 'design.png'),
          pending('cdr', DesignFileType.CDR, 'source.cdr'),
        ],
      },
    });

    expect(html).toContain('data-slot="local-design-image-preview"');
    expect(html.match(/data-slot="design-file-marker"/g)).toHaveLength(2);
    expect(html).toContain('<span>CDR</span>');
    expect(html).toContain('design.png');
    expect(html).toContain('source.cdr');
  });

  it('keeps copy available for one style and removes only the active extra style', () => {
    const single = render();
    expect(single).toContain('⧉ 复制当前');
    expect(single).not.toContain('删除当前');

    recordedButtonProps.length = 0;
    const onRemove = vi.fn();
    const multiple = render(undefined, {
      itemCount: 2,
      activeIndex: 1,
      onRemove,
    });
    expect(multiple).toContain('删除当前');
    expect(multiple).toContain('aria-label="删除第 2 款"');

    const removeButton = recordedButtonProps.find(
      (props) => props['aria-label'] === '删除第 2 款',
    );
    expect(removeButton).toBeDefined();
    removeButton?.onClick?.({});
    expect(onRemove).toHaveBeenCalledOnce();
    expect(onRemove).toHaveBeenCalledWith(1);
  });

  it('shows stock front/back foil controls and disables mixed packing for one style', () => {
    const html = render();

    expect(html).toContain('正面');
    expect(html).toContain('反面');
    expect(html).toContain('＋ 加烫反面');
    expect(html).toContain('常规装');
    expect(html).not.toMatch(/0\.[12]\s*元\/袋/);
    expect(html).toContain('混装需两款以上');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?混装/);
    expect(html).toContain('共 200 包');
  });

  it('cancels the final color and wires direct order editing without moving the palette', () => {
    const onFoilSidesChange = vi.fn();
    render(undefined, { onFoilSidesChange });

    const selectedGold = recordedButtonProps.find(
      (props) => props['aria-label'] === '亚金，第 1 色',
    );
    expect(selectedGold).toBeDefined();
    selectedGold?.onClick?.({});
    expect(onFoilSidesChange).toHaveBeenLastCalledWith([], []);

    recordedButtonProps.length = 0;
    onFoilSidesChange.mockClear();
    const ordered = item(OrderItemPricingRoute.STOCK_BLANK);
    ordered.frontFoilColors = ['红色', '亚金', '浅色'];
    ordered.foilColors = ['红色', '亚金', '浅色'];
    ordered.isDoubleColor = true;
    const html = render(ordered, { onFoilSidesChange });

    expect(html.indexOf('aria-label="亚金，第 2 色"')).toBeLessThan(
      html.indexOf('aria-label="红色，第 1 色"'),
    );

    recordedButtonProps
      .find((props) => props['aria-label'] === '将第 2 色 亚金 上移')
      ?.onClick?.({});
    expect(onFoilSidesChange).toHaveBeenLastCalledWith(
      ['亚金', '红色', '浅色'],
      [],
    );

    recordedButtonProps
      .find((props) => props['aria-label'] === '将第 2 色 亚金 下移')
      ?.onClick?.({});
    expect(onFoilSidesChange).toHaveBeenLastCalledWith(
      ['红色', '浅色', '亚金'],
      [],
    );

    recordedButtonProps
      .find((props) => props['aria-label'] === '移除第 2 色 亚金')
      ?.onClick?.({});
    expect(onFoilSidesChange).toHaveBeenLastCalledWith(
      ['红色', '浅色'],
      [],
    );
  });

  it('reveals the B-only process controls for full foil and coated color print', () => {
    const full = render(item(OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL));
    expect(full).toContain('特殊工艺');
    expect(full).toContain('浮雕');
    expect(full).toContain('激凸');
    expect(full).toContain('改尺寸');
    expect(full).not.toContain('＋ 加烫反面');

    const colorItem = item(OrderItemPricingRoute.COLOR_PRINT);
    colorItem.paperType = '铜版纸';
    colorItem.lamination = OrderLamination.MATTE;
    colorItem.frontFoilColors = [];
    colorItem.foilColors = [];
    colorItem.hasLocalFoil = false;
    colorItem.foilTechnique = OrderFoilTechnique.NONE;
    colorItem.printColors = ['彩印'];
    const color = render(colorItem, { paperKey: 'tbz' });
    expect(color).toContain('覆膜');
    expect(color).toContain('亚膜');
    expect(color).toContain('触感膜');
    expect(color).toContain('新光膜');
    expect(color).toContain('雷射');
    expect(color).toContain('叠加烫金');
  });
});
