'use client';

import { useActionState, useRef } from 'react';
import { emptyBomDraft, type FormDraftContext, type BomDraft } from '@/lib/form-drafts/model';
import { useFormDraft } from '@/components/business/form-drafts/useFormDraft';
import { DraftIdentityFields, DraftNotice, SupplementLink } from '@/components/business/form-drafts/FormDraftControls';
import type { BomMutationResult } from '@/actions/owner-boms.types';
import { Button, buttonVariants } from '@/components/ui/button';
import { PendingLink } from '@/components/ui-business';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RULE_CENTER_HREFS } from '@/lib/navigation/rule-center';
import { BLANK_SPECIFICATIONS } from '@/lib/price/blank-paper';
import { externalPriceBusinessText } from '@/lib/price/external-price-display';

export type BomProductOption = {
  id: string;
  code: string | null;
  name: string;
  categoryName: string;
};

export type BomCategoryOption = {
  id: string;
  path: string;
  name: string;
};

export type BomMaterialOption = {
  id: string;
  code: string;
  name: string;
  unit: string;
};

type Props = {
  action: (
    prev: BomMutationResult | null,
    fd: FormData,
  ) => Promise<BomMutationResult>;
  draftContext: FormDraftContext;
  initialRowId: string;
  papers: Array<{ id: string; name: string; specification: string | null }>;
  products: BomProductOption[];
  categories: BomCategoryOption[];
  materials: BomMaterialOption[];
};

const selectClass =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50';

export function BomForm({ action, products, categories, materials, papers, draftContext, initialRowId }: Props) {
  const [state, formAction, pending] = useActionState<
    BomMutationResult | null,
    FormData
  >(action, null);
  const formRef = useRef<HTMLFormElement>(null);
  const draft = useFormDraft(draftContext, emptyBomDraft(initialRowId), formRef);
  const { payload } = draft;
  const { rows, targetType } = payload;
  const disabled = pending || draft.editingBlocked;
  const change = <K extends keyof BomDraft>(key: K, value: BomDraft[K]) => draft.update((current) => ({ ...current, [key]: value }));
  const changeRow = (rowId: string, key: 'materialId' | 'quantity' | 'remark', value: string) => draft.update((current) => ({ ...current, rows: current.rows.map((row) => row.rowId === rowId ? { ...row, [key]: value } : row) }));
  const errs = state?.status === 'invalid' ? state.fieldErrors : {};
  const error = state?.status === 'error' ? state.message : null;
  const missingProducts = products.length === 0;
  const missingCategories = categories.length === 0;
  const missingMaterials = materials.length === 0;
  const missingTarget =
    targetType === 'BLANK' ? papers.length === 0 : targetType === 'PRODUCT' ? missingProducts : missingCategories;

  return (
    <form ref={formRef} action={formAction} aria-busy={pending} className="space-y-5" noValidate>
      <DraftIdentityFields identity={draft.identity} />
      <DraftNotice draft={draft} />
      <input type="hidden" name="itemCount" value={rows.length} />

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="targetType">适用对象</Label>
          <select
            id="targetType"
            name="targetType"
            className={selectClass}
            value={targetType}
            onChange={(event) =>
              change('targetType', event.target.value as BomDraft['targetType'])
            }
            disabled={disabled}
          >
            <option value="BLANK">空白封纸张与规格</option>
            <option value="PRODUCT">其他产品</option>
            <option value="CATEGORY">产品结构分类</option>
          </select>
          {errs.targetType?.[0] ? (
            <p className="text-sm text-destructive">{errs.targetType[0]}</p>
          ) : null}
        </div>
        <TextField
          id="name"
          value={payload.name}
          onChange={(value) => change('name', value)}
          label="BOM 名称"
          disabled={disabled}
          error={errs.name?.[0]}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="productId">其他产品</Label>
          </div>
          <select
            id="productId"
            name="productId"
            className={selectClass}
            value={payload.productId}
            onChange={(event) => change('productId', event.target.value)}
            disabled={disabled || targetType !== 'PRODUCT' || missingProducts}
          >
            <option value="">请选择其他产品</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.code ? `${product.code} · ` : ''}
                {externalPriceBusinessText(product.name)}（
                {externalPriceBusinessText(product.categoryName)}）
              </option>
            ))}
          </select>
          {errs.productId?.[0] ? (
            <p className="text-sm text-destructive">{errs.productId[0]}</p>
          ) : null}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="categoryNodeId">产品结构分类</Label>
            <SupplementLink href={`${RULE_CENTER_HREFS.productCategories}/new`} disabled={pending || draft.blocked || targetType !== 'CATEGORY'} onSupplement={() => draft.supplement('CATEGORY', 'categoryNodeId')}>新建分类</SupplementLink>
          </div>
          <select
            id="categoryNodeId"
            name="categoryNodeId"
            className={selectClass}
            value={payload.categoryNodeId}
            onChange={(event) => change('categoryNodeId', event.target.value)}
            disabled={disabled || targetType !== 'CATEGORY' || missingCategories}
          >
            <option value="">请选择分类</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
          {errs.categoryNodeId?.[0] ? (
            <p className="text-sm text-destructive">{errs.categoryNodeId[0]}</p>
          ) : null}
        </div>
      </div>

      {targetType === 'BLANK' ? (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="blankPaperMaterialId">纸张</Label>
            <select id="blankPaperMaterialId" name="blankPaperMaterialId" className={selectClass} disabled={disabled} value={payload.blankPaperMaterialId} onChange={(event) => change('blankPaperMaterialId', event.target.value)}>
              <option value="">请选择纸张</option>
              {papers.map((paper) => <option key={paper.id} value={paper.id}>{externalPriceBusinessText(paper.name)} {externalPriceBusinessText(paper.specification ?? '')}</option>)}
            </select>
            {errs.blankPaperMaterialId?.[0] ? <p className="text-sm text-destructive">{errs.blankPaperMaterialId[0]}</p> : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="blankSpecificationKey">规格</Label>
            <select id="blankSpecificationKey" name="blankSpecificationKey" className={selectClass} disabled={disabled} value={payload.blankSpecificationKey} onChange={(event) => change('blankSpecificationKey', event.target.value)}>
              <option value="">请选择规格</option>
              {BLANK_SPECIFICATIONS.map((spec) => <option key={spec.key} value={spec.key}>{spec.specification}</option>)}
            </select>
            {errs.blankSpecificationKey?.[0] ? <p className="text-sm text-destructive">{errs.blankSpecificationKey[0]}</p> : null}
          </div>
        </div>
      ) : null}

      {missingTarget ? (
        <p className="text-sm text-muted-foreground">
          {targetType === 'BLANK' ? '暂无可用纸张，请先维护纸张资料。' : targetType === 'PRODUCT'
            ? '暂无可用产品。'
            : '暂无可用产品结构分类，请先创建并启用。'}
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <TextField
          id="version"
          value={payload.version}
          onChange={(value) => change('version', value)}
          label="版本号"
          disabled={disabled}
          error={errs.version?.[0]}
        />
        <TextField
          id="baseQuantity"
          value={payload.baseQuantity}
          onChange={(value) => change('baseQuantity', value)}
          label="基准产量"
          disabled={disabled}
          error={errs.baseQuantity?.[0]}
        />
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">物料行</h2>
          <Button
            type="button"
            variant="outline"
            disabled={disabled || rows.length >= 20}
            onClick={() => draft.update((current) => ({ ...current, rows: [...current.rows, { rowId: crypto.randomUUID(), materialId: '', quantity: '', remark: '' }] }))}
          >
            添加物料
          </Button>
        </div>
        {errs.items?.[0] ? (
          <p className="text-sm text-destructive">{errs.items[0]}</p>
        ) : null}
        <div className="space-y-3">
          {rows.map((row, index) => (
            <div key={row.rowId} className="rounded-lg border p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">#{index + 1}</span>
                {rows.length > 1 ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={disabled}
                    onClick={() =>
                      draft.update((current) => ({ ...current, rows: current.rows.filter((item) => item.rowId !== row.rowId) }))
                    }
                  >
                    删除
                  </Button>
                ) : null}
              </div>
              <div className="grid gap-3 md:grid-cols-[1fr_10rem_1fr]">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor={`items.${index}.materialId`}>物料</Label>
                    <SupplementLink href="/owner/materials/new" disabled={pending || draft.blocked} onSupplement={() => draft.supplement('MATERIAL', `row:${row.rowId}`)}>新建物料</SupplementLink>
                  </div>
                  <select
                    id={`items.${index}.materialId`}
                    name={`items.${index}.materialId`}
                    className={selectClass}
                    value={row.materialId}
                    onChange={(event) => changeRow(row.rowId, 'materialId', event.target.value)}
                    disabled={disabled || missingMaterials}
                  >
                    <option value="">请选择物料</option>
                    {materials.map((material) => (
                      <option key={material.id} value={material.id}>
                        {material.code} · {externalPriceBusinessText(material.name)}（
                        {material.unit}）
                      </option>
                    ))}
                  </select>
                </div>
                <TextField
                  id={`items.${index}.quantity`}
                  name={`items.${index}.quantity`}
                  value={row.quantity}
                  onChange={(value) => changeRow(row.rowId, 'quantity', value)}
                  label="用量"
                  disabled={disabled}
                />
                <TextField
                  id={`items.${index}.remark`}
                  name={`items.${index}.remark`}
                  value={row.remark}
                  onChange={(value) => changeRow(row.rowId, 'remark', value)}
                  label="备注"
                  disabled={disabled}
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      {missingMaterials ? (
        <p className="text-sm text-muted-foreground">
          暂无可用物料，请先创建并启用至少一种物料。
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={pending || draft.blocked || missingTarget || missingMaterials}>
          {pending ? '提交中…' : '创建 BOM'}
        </Button>
        <PendingLink
          href="/owner/boms"
          pending={pending}
          className={buttonVariants({ variant: 'outline' })}
        >
          返回列表
        </PendingLink>
      </div>
    </form>
  );
}

function TextField({
  id,
  name = id,
  label,
  error,
  value,
  onChange,
  disabled,
}: {
  id: string;
  name?: string;
  label: string;
  error?: string | undefined;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        aria-invalid={Boolean(error)}
      />
      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : null}
    </div>
  );
}
