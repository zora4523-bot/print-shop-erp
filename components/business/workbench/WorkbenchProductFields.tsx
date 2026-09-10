'use client';

import type { ExternalCreateOrderOptions } from '@/lib/order/create-order-options';
import { catalogPricingFactChoices } from '@/lib/order/catalog-pricing-facts';
import { workbenchPaperChoices } from '@/lib/workbench/catalog';
import { Button } from '@/components/ui/button';
import { WorkbenchChoice } from './WorkbenchChoice';

type Selection = {
  productId: string;
  specification: string;
  paperType: string;
};
export function WorkbenchProductFields({
  products,
  papers,
  selection,
  onChange,
}: {
  products: ExternalCreateOrderOptions['products'];
  papers: ExternalCreateOrderOptions['papers'];
  selection: Selection;
  onChange: (selection: Selection) => void;
}) {
  const product = products.find((item) => item.id === selection.productId);
  const specsFor = (item: (typeof products)[number]) =>
    catalogPricingFactChoices(item.specification);
  const papersFor = (item: (typeof products)[number]) =>
    workbenchPaperChoices(item, papers);
  const linkedPaper = product?.paperMaterialId
    ? papers.find((paper) => paper.id === product.paperMaterialId)
    : undefined;
  const linkedPaperUnavailable =
    product?.paperMaterialId && (!linkedPaper || linkedPaper.outOfStock);
  const candidates = product
    ? [product]
    : products.filter(
        (item) =>
          (!selection.specification ||
            specsFor(item).includes(selection.specification)) &&
          (!selection.paperType ||
            papersFor(item).includes(selection.paperType)),
      );
  const choices = (values: string[]) =>
    [...new Set(values)].map((value) => ({ value, label: value }));
  function choose(next: Selection) {
    const matches = products.filter(
      (item) =>
        (!next.productId || item.id === next.productId) &&
        (!next.specification || specsFor(item).includes(next.specification)) &&
        (!next.paperType || papersFor(item).includes(next.paperType)),
    );
    const match = matches.length === 1 ? matches[0] : undefined;
    if (match) {
      next.productId = match.id;
      const specs = specsFor(match);
      const paperOptions = papersFor(match);
      if (!next.specification && specs.length === 1)
        next.specification = specs[0]!;
      if (!next.paperType && paperOptions.length === 1)
        next.paperType = paperOptions[0]!;
    }
    onChange(next);
  }
  return (
    <>
      <WorkbenchChoice
        label="产品"
        value={selection.productId}
        options={(product ? products : candidates).map((item) => ({
          value: item.id,
          label: item.name,
        }))}
        onChange={(productId) => {
          const selected = products.find((item) => item.id === productId);
          choose({
            productId,
            specification:
              selected && specsFor(selected).includes(selection.specification)
                ? selection.specification
                : '',
            paperType:
              selected && papersFor(selected).includes(selection.paperType)
                ? selection.paperType
                : '',
          });
        }}
      />
      <p className="text-sm text-muted-foreground">
        可先选产品，也可先选规格或纸张；匹配到唯一产品时自动选中。
      </p>
      {!product &&
        (selection.specification || selection.paperType) &&
        candidates.length > 1 && (
          <p className="text-sm text-muted-foreground">
            有 {candidates.length}{' '}
            个产品符合选择，请继续选择规格或纸张，或在产品中确认。
          </p>
        )}
      <div className="grid gap-4 sm:grid-cols-2">
        <WorkbenchChoice
          label="规格"
          value={selection.specification}
          options={choices(products.flatMap(specsFor))}
          onChange={(specification) => {
            const matching = products.filter((item) =>
              specsFor(item).includes(specification),
            );
            choose({
              productId:
                product && specsFor(product).includes(specification)
                  ? product.id
                  : '',
              specification,
              paperType: matching.some((item) =>
                papersFor(item).includes(selection.paperType),
              )
                ? selection.paperType
                : '',
            });
          }}
        />
        <WorkbenchChoice
          label="纸张"
          value={selection.paperType}
          options={choices(candidates.flatMap(papersFor))}
          onChange={(paperType) => choose({ ...selection, paperType })}
        />
      </div>
      {linkedPaperUnavailable && (
        <p className="text-sm text-muted-foreground">
          所选产品的纸张已缺货或停用，请选择其他产品或联系管理员补充资料
        </p>
      )}
      {(selection.productId ||
        selection.specification ||
        selection.paperType) && (
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          onClick={() =>
            onChange({ productId: '', specification: '', paperType: '' })
          }
        >
          重新选择产品、规格和纸张
        </Button>
      )}
      {!products.length && (
        <p className="text-sm text-muted-foreground">
          暂无此类型产品，请选择其他产品类型
        </p>
      )}
    </>
  );
}
