import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  moveOrderFoilSelection,
  nextOrderFoilSelection,
  OrderFoilSwatchPicker,
} from '../order-form-b/OrderFoilSwatchPicker';
import { OrderSubmissionReviewContent } from '../order-form-b/OrderSubmissionReviewDialog';
import { OrderSubmissionSuccess } from '../order-form-b/OrderSubmissionSuccess';
import { DesignFileType } from '@/generated/prisma/enums';

const noop = vi.fn();

describe('OrderFoilSwatchPicker', () => {
  it('recognizes a saved matte-gold alias instead of selecting a second color', () => {
    expect(nextOrderFoilSelection({ current: ['哑金'], option: '亚金',
      maxSelections: 3, minimumSelections: 1 })).toEqual(['哑金']);
    const html = renderToStaticMarkup(<OrderFoilSwatchPicker id="legacy-gold"
      value={['哑金']} options={[{ value: '亚金', label: '亚金' }]} onChange={noop} />);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-label="亚金，第 1 色"');
    expect(html).not.toContain('background-size:10px 10px');
  });

  it('keeps selection order, respects the minimum, and replaces in single-select mode', () => {
    expect(
      nextOrderFoilSelection({
        current: ['哑金'],
        option: '哑金',
        maxSelections: 3,
        minimumSelections: 1,
      }),
    ).toEqual(['哑金']);
    expect(
      nextOrderFoilSelection({
        current: ['哑金'],
        option: '红色',
        maxSelections: 3,
        minimumSelections: 1,
      }),
    ).toEqual(['哑金', '红色']);
    expect(
      nextOrderFoilSelection({
        current: ['哑金'],
        option: '银色',
        maxSelections: 1,
        minimumSelections: 1,
      }),
    ).toEqual(['银色']);
    expect(
      nextOrderFoilSelection({
        current: ['哑金'],
        option: '哑金',
        maxSelections: 3,
        minimumSelections: 0,
      }),
    ).toEqual([]);
  });

  it('moves an existing selection without changing the fixed palette order', () => {
    expect(
      moveOrderFoilSelection({
        current: ['红色', '哑金', '银色'],
        option: '哑金',
        direction: 'up',
      }),
    ).toEqual(['哑金', '红色', '银色']);
    expect(
      moveOrderFoilSelection({
        current: ['红色', '哑金', '银色'],
        option: '哑金',
        direction: 'down',
      }),
    ).toEqual(['红色', '银色', '哑金']);
    expect(
      moveOrderFoilSelection({
        current: ['红色', '哑金'],
        option: '红色',
        direction: 'up',
      }),
    ).toEqual(['红色', '哑金']);
  });

  it('shows selected ordinals and disables unselected colors at the cap', () => {
    const html = renderToStaticMarkup(
      <OrderFoilSwatchPicker
        id="foil"
        value={['红色', '哑金']}
        maxSelections={2}
        minimumSelections={0}
        options={[
          {
            value: '哑金',
            label: '哑金',
            tone: 'matte-gold',
            imageSrc: '/images/order/foil/matte-gold.png',
          },
          { value: '红色', label: '红色', tone: 'red' },
          { value: '银色', label: '银色', tone: 'silver' },
        ]}
        onChange={noop}
      />,
    );

    expect(html).toContain('aria-label="哑金，第 2 色"');
    expect(html).toContain('aria-label="红金，第 1 色"');
    expect(html.indexOf('aria-label="哑金，第 2 色"')).toBeLessThan(
      html.indexOf('aria-label="红金，第 1 色"'),
    );
    expect(html).toContain('%2Fimages%2Forder%2Ffoil%2Fmatte-gold.png');
    expect(html).toMatch(/<img[^>]*alt=""[^>]*aria-hidden="true"/);
    expect(html).toContain('data-selection-order="1"');
    expect(html).toContain('data-selection-order="2"');
    expect(html).not.toContain('bg-black/85');
    expect(html).not.toContain('shadow-[0_4px_12px');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="银金"/);
    expect(html).toContain('已选 2/2');
    expect(html).toMatch(
      /class="sr-only">，选择顺序：第 1 色 红金 · 第 2 色 哑金<\/span>/,
    );
    expect(html).toContain('烫印顺序');
    expect(html.indexOf('data-order-color="红色"')).toBeLessThan(
      html.indexOf('data-order-color="哑金"'),
    );
    expect(html).toContain('aria-label="将第 1 色 红金 上移"');
    expect(html).toContain('aria-label="将第 1 色 红金 下移"');
    expect(html).toContain('aria-label="移除第 1 色 红金"');
    expect(html).not.toContain('已选满，取消一个再换');
  });

  it('keeps a visible material fallback for transparent foil without a photo', () => {
    const html = renderToStaticMarkup(
      <OrderFoilSwatchPicker
        id="clear-foil"
        value={['透明色']}
        options={[
          { value: '透明色', label: '透明色', tone: 'clear' },
        ]}
        onChange={noop}
      />,
    );

    expect(html).toContain('background-size:10px 10px');
    expect(html).toContain('background-image:linear-gradient(45deg');
  });

  it('does not render an unknown material as transparent foil', () => {
    const html = renderToStaticMarkup(<OrderFoilSwatchPicker id="custom-foil" value={[]}
      options={[{ value: '品牌色', label: '品牌色' }]} onChange={noop} />);
    expect(html).not.toContain('background-size:10px 10px');
    expect(html).not.toContain('background-image:linear-gradient(45deg');
  });
});

describe('OrderSubmissionReviewContent', () => {
  it('shows every delivery and allocation before submitting a multi-address order', () => {
    const html = renderToStaticMarkup(<OrderSubmissionReviewContent
      orderName="多地址工单" items={[]}
      receiver={{ name: '主收件人', phone: '13800138000', address: '广东主地址', quantityLabel: '600 件' }}
      additionalReceivers={[{ name: '第二收件人', phone: '13900139000', address: '江西第二地址', quantityLabel: '400 件' }]}
      shippingCharge={{ label: '快递费', amountLabel: '¥18.70' }} totalLabel="¥118.70"
      onBack={noop} onConfirm={noop}
    />);
    expect(html).toContain('地址 1 · 600 件');
    expect(html).toContain('地址 2 · 400 件');
    expect(html).toContain('广东主地址');
    expect(html).toContain('江西第二地址');
    expect(html).toContain('13900139000');
  });

  it('places quantity and specification first and exposes every consequence before confirmation', () => {
    const html = renderToStaticMarkup(
      <OrderSubmissionReviewContent
        orderName="福明实业周年庆"
        items={[
          {
            id: 'style-1',
            number: 1,
            quantityLabel: '1,000',
            quantityInWords: '一千',
            quantityDetail: '10 个一包，共 100 包',
            specification: '大号封',
            dimensions: '90×165mm',
            materialSummary: '局部烫金 · 触感纸 200g',
            processSummary: (
              <>
                烫金 <strong>正面哑金</strong>
              </>
            ),
            facts: [
              { label: '不烫反面', critical: true },
              { label: '未上传 CDR' },
            ],
            artwork: {
              name: '周年庆设计图.png',
              meta: '48 KB',
              previewImage: {
                file: {
                  name: '周年庆设计图.png',
                  size: 48 * 1024,
                } as File,
                fileType: DesignFileType.IMAGE,
                mimeType: 'image/png',
              },
            },
            amountLabel: '待核价',
            manualQuoteReasons: ['自定义尺寸未配置价格'],
          },
        ]}
        receiver={{
          name: '张三',
          phone: '13800138000',
          address: '广东省佛山市南海区测试路 1 号',
        }}
        cartonCharge={{
          label: '纸箱耗材',
          amountLabel: '¥5.00',
          detail: '2,000 个',
        }}
        shippingCharge={{
          label: '快递费',
          amountLabel: '待定',
          detail: '中通',
          note: '地址未匹配价格',
        }}
        totalLabel={'含待核价款\n总价由工厂确认'}
        totalRequiresManualQuote
        totalNote="不含制版费与快递费。"
        confirmLabel="确认提交并申请核价"
        onBack={noop}
        onConfirm={noop}
      />,
    );

    expect(html).toContain('data-slot="order-submission-review"');
    expect(html).toContain('提交前复核');
    expect(html).toContain('请重点核对这两项');
    expect(html).not.toContain('仍是默认');
    expect(html).not.toContain('data-review-warning="quantity"');
    expect(html).toContain('data-slot="local-design-image-preview"');
    expect(html).toContain('第 1 款设计图预览：周年庆设计图.png');
    expect(html).toContain('48 KB');
    expect(html).toContain('不烫反面');
    expect(html).toContain('人工核价：自定义尺寸未配置价格');
    expect(html).toContain('收货与快递');
    expect(html).toContain('广东省佛山市南海区测试路 1 号');
    expect(html).toContain('确认提交并申请核价');
    expect(html).toContain('grid-cols-[1fr_1.6fr]');
  });

  it('wraps the review in the repository Dialog primitive with top-aligned B geometry', () => {
    const source = readFileSync(
      path.join(
        process.cwd(),
        'components/business/order/order-form-b/OrderSubmissionReviewDialog.tsx',
      ),
      'utf8',
    );

    expect(source).toContain('<Dialog open={open} onOpenChange={onOpenChange}>');
    expect(source).toContain('showCloseButton={false}');
    expect(source).toContain('max-w-2xl');
    expect(source).toContain('sm:top-6');
    expect(source).toContain('onOpenChange(false);');
  });
});

describe('OrderSubmissionSuccess', () => {
  it('announces the submitted order and renders the B manual-quote state', () => {
    const html = renderToStaticMarkup(
      <OrderSubmissionSuccess
        orderNumber="GD-20260827-1234"
        statusLabel="待工厂核价确认"
        description="工厂核价后会通知你。核价前不会安排生产。"
        manualQuote
        primaryAction={{ label: '再建一单', onClick: noop }}
        secondaryAction={{ label: '返回工单列表', onClick: noop }}
      />,
    );

    expect(html).toContain('data-slot="order-submission-success"');
    expect(html).toContain('data-tone="manual-quote"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('工单已提交');
    expect(html).toContain('GD-20260827-1234');
    expect(html).toContain('待工厂核价确认');
    // 待工厂核价 = 主强调，不是失败色（§4.3）。
    expect(html).toContain('border-primary bg-primary/5 text-primary">待工厂核价确认');
    expect(html).not.toContain('bg-destructive/5');
    expect(html).toContain('再建一单');
    expect(html).toContain('返回工单列表');
  });
});
