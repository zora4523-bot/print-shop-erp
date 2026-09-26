import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import {
  OrderItemPricingRoute,
  OrderStatus,
} from '@/generated/prisma/enums';

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useActionState: (_action: unknown, initialState: unknown) => [
      initialState,
      vi.fn(),
      true,
    ],
    useTransition: () => [true, vi.fn()],
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/actions/bill', () => ({
  createOrderCostEntryAction: vi.fn(),
  generateBillsAction: vi.fn(),
}));

vi.mock('@/actions/order', () => ({
  createOrderChangeRequestAction: vi.fn(),
  createReworkOrderAction: vi.fn(),
  setOrderSfCollectAction: vi.fn(),
  updateOrderAction: vi.fn(),
}));

vi.mock('@/actions/outsource', () => ({
  confirmOutsourceAmountAction: vi.fn(),
  createOutsourceAction: vi.fn(),
}));

import { GenerateBillsForm } from '@/components/business/bill/GenerateBillsForm';
import { OrderCostEntryForm } from '@/components/business/bill/OrderCostEntryForm';
import { EditOrderForm } from '@/components/business/order/EditOrderForm';
import { OrderChangeRequestForm } from '@/components/business/order/OrderChangeRequestForm';
import { ReworkOrderForm } from '@/components/business/order/ReworkOrderForm';
import { SfCollectToggleForm } from '@/components/business/order/SfCollectToggleForm';
import { CreateOutsourceForm } from '@/components/business/outsource/CreateOutsourceForm';
import { OutsourceAmountForm } from '@/components/business/outsource/OutsourceAmountForm';

const IDEMPOTENCY_KEY = '00000000-0000-4000-8000-000000000001';
const SNAPSHOT_FORM_FILES = [
  'bill/GenerateBillsForm.tsx',
  'bill/OrderCostEntryForm.tsx',
  'order/EditOrderForm.tsx',
  'order/OrderChangeRequestForm.tsx',
  'order/ReworkOrderForm.tsx',
  'order/SfCollectToggleForm.tsx',
  'outsource/CreateOutsourceForm.tsx',
  'outsource/OutsourceAmountForm.tsx',
] as const;

function pendingForms(): Record<string, string> {
  return {
    GenerateBillsForm: renderToStaticMarkup(
      <GenerateBillsForm defaultPeriod="2026-08" />,
    ),
    OrderCostEntryForm: renderToStaticMarkup(
      <OrderCostEntryForm
        orderId="order-1"
        initialIdempotencyKey={IDEMPOTENCY_KEY}
        isSfCollect={false}
      />,
    ),
    EditOrderForm: renderToStaticMarkup(
      <EditOrderForm
        orderId="order-1"
        expectedEditVersion={7}
        fieldset="FULL"
        initial={{
          customName: '测试工单',
          receiverAddress: null,
          expressCode: null,
          packageRequirement: null,
          remark: null,
          promisedDate: '2026-08-31',
          isUrgent: false,
        }}
      />,
    ),
    OrderChangeRequestForm: renderToStaticMarkup(
      <OrderChangeRequestForm
        orderId="order-1"
        expectedRevision={3}
        expectedWorkOrderVersion={2}
        items={[
          {
            id: 'item-1',
            sequence: 1,
            name: '纸盒',
            quantity: 100,
            productId: null,
            pricingRoute: OrderItemPricingRoute.MANUAL_QUOTE,
            specification: null,
            paperType: null,
            paperWeightGsm: null,
            foilColors: [],
          },
        ]}
        catalogProducts={[]}
      />,
    ),
    ReworkOrderForm: renderToStaticMarkup(
      <ReworkOrderForm
        sourceOrderId="order-1"
        items={[
          {
            id: 'item-1',
            sequence: 1,
            name: '纸盒',
            quantity: 100,
            crafts: [
              { id: 'craft-1', name: '模切', isOutsource: false },
            ],
          },
        ]}
      />,
    ),
    SfCollectToggleForm: renderToStaticMarkup(
      <SfCollectToggleForm
        orderId="order-1"
        currentValue
        status={OrderStatus.SHIPPED}
        isExternalSales
        shipments={[
          {
            id: 'shipment-1',
            sequence: 1,
            destinationProvince: '浙江',
            weightKg: '12.5',
            shippingFee: null,
            customerChargeOverrideReason: null,
          },
        ]}
      />,
    ),
    CreateOutsourceForm: renderToStaticMarkup(
      <CreateOutsourceForm
        orderId="order-1"
        orderNo="PS-20260825-001"
        items={[{ id: 'item-1', sequence: 1, name: '纸盒', quantity: 100 }]}
        initialIdempotencyKey={IDEMPOTENCY_KEY}
      />,
    ),
    OutsourceAmountForm: renderToStaticMarkup(
      <OutsourceAmountForm
        id="outsource-1"
        currentAmount={null}
        initialIdempotencyKey={IDEMPOTENCY_KEY}
      />,
    ),
  };
}

describe('critical form pending snapshot lock', () => {
  it('announces every in-flight form as busy and disables rendered controls', () => {
    for (const [name, html] of Object.entries(pendingForms())) {
      expect(html, name).toMatch(/<form[^>]*aria-busy="true"/);
      const visibleControls =
        html.match(/<(?:button|input|select|textarea)\b[^>]*>/g) ?? [];
      for (const control of visibleControls) {
        if (/type="hidden"/.test(control)) continue;
        expect(control, `${name}: ${control}`).toContain('disabled=""');
      }
    }
  });

  it.each(SNAPSHOT_FORM_FILES)(
    '%s declares a pending lock for every editable control path',
    (relativePath) => {
      const filePath = path.join(
        process.cwd(),
        'components',
        'business',
        relativePath,
      );
      const sourceText = readFileSync(filePath, 'utf8');
      const source = ts.createSourceFile(
        filePath,
        sourceText,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      const failures: string[] = [];

      const visit = (node: ts.Node) => {
        if (
          (ts.isJsxOpeningElement(node) ||
            ts.isJsxSelfClosingElement(node)) &&
          isEditableControl(node)
        ) {
          const disabledExpression = jsxAttributeExpression(node, 'disabled');
          if (
            disabledExpression === null ||
            (!disabledExpression.includes('pending') &&
              disabledExpression !== 'disabled')
          ) {
            const line =
              source.getLineAndCharacterOfPosition(node.getStart(source)).line +
              1;
            failures.push(
              `${node.tagName.getText()} at line ${line} (${disabledExpression ?? 'missing disabled'})`,
            );
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);

      expect(
        failures,
        `${relativePath} has editable controls without a pending-aware disabled contract`,
      ).toEqual([]);
    },
  );

  it('keeps stable hidden payload controls enabled and unchanged', () => {
    const forms = pendingForms();
    for (const [name, html] of Object.entries(forms)) {
      const hiddenInputs =
        html.match(/<input[^>]*type="hidden"[^>]*>/g) ?? [];
      for (const hiddenInput of hiddenInputs) {
        expect(hiddenInput, name).not.toContain('disabled=""');
      }
    }

    expect(forms.OrderCostEntryForm).toContain(
      `<input type="hidden" name="idempotencyKey" value="${IDEMPOTENCY_KEY}"/>`,
    );
    expect(forms.OrderCostEntryForm).toContain(
      '<input type="hidden" name="orderId" value="order-1"/>',
    );
    const sfCollectHtml = forms.SfCollectToggleForm;
    expect(sfCollectHtml).toContain(
      '<input type="hidden" name="isSfCollect" value="false"/>',
    );
    expect(sfCollectHtml).toContain(
      '<input type="hidden" name="sfShipmentId" value="shipment-1"/>',
    );
    expect(sfCollectHtml.match(/<input[^>]*type="hidden"[^>]*>/g)).not.toEqual(
      expect.arrayContaining([expect.stringContaining('disabled=""')]),
    );
  });
});

function isEditableControl(
  node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
): boolean {
  const tagName = node.tagName.getText();
  if (
    ![
      'Button',
      'Checkbox',
      'Field',
      'Input',
      'input',
      'select',
      'textarea',
    ].includes(
      tagName,
    )
  ) {
    return false;
  }
  if (tagName !== 'input') return true;

  const typeAttribute = node.attributes.properties.find(
    (property) =>
      ts.isJsxAttribute(property) && property.name.getText() === 'type',
  );
  return !(
    typeAttribute &&
    ts.isJsxAttribute(typeAttribute) &&
    typeAttribute.initializer &&
    ts.isStringLiteral(typeAttribute.initializer) &&
    typeAttribute.initializer.text === 'hidden'
  );
}

function jsxAttributeExpression(
  node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  name: string,
): string | null {
  const attribute = node.attributes.properties.find(
    (property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) && property.name.getText() === name,
  );
  if (!attribute?.initializer) return null;
  return ts.isJsxExpression(attribute.initializer)
    ? attribute.initializer.expression?.getText() ?? null
    : attribute.initializer.getText();
}
