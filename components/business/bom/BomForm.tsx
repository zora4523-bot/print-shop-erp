'use client';

import { useActionState, useState } from 'react';
import type { BomMutationResult } from '@/actions/owner-boms.types';
import { Button, buttonVariants } from '@/components/ui/button';
import { PendingLink } from '@/components/ui-business/PendingLink';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

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
  products: BomProductOption[];
  categories: BomCategoryOption[];
  materials: BomMaterialOption[];
};

const selectClass =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50';

export function BomForm({ action, products, categories, materials }: Props) {
  const [state, formAction, pending] = useActionState<
    BomMutationResult | null,
    FormData
  >(action, null);
  const [rows, setRows] = useState([{ key: 0 }]);
  const [targetType, setTargetType] = useState<'PRODUCT' | 'CATEGORY'>('PRODUCT');
  const errs = state?.status === 'invalid' ? state.fieldErrors : {};
  const error = state?.status === 'error' ? state.message : null;
  const missingProducts = products.length === 0;
  const missingCategories = categories.length === 0;
  const missingMaterials = materials.length === 0;
  const missingTarget =
    targetType === 'PRODUCT' ? missingProducts : missingCategories;

  return (
    <form action={formAction} aria-busy={pending} className="space-y-5" noValidate>
      <input type="hidden" name="itemCount" value={rows.length} />

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="targetType">BOM 目标</Label>
          <select
            id="targetType"
            name="targetType"
            className={selectClass}
            value={targetType}
            onChange={(event) =>
              setTargetType(event.target.value as 'PRODUCT' | 'CATEGORY')
            }
            disabled={pending}
          >
            <option value="PRODUCT">产品</option>
            <option value="CATEGORY">产品分类</option>
          </select>
          {errs.targetType?.[0] ? (
            <p className="text-sm text-destructive">{errs.targetType[0]}</p>
          ) : null}
        </div>
        <TextField
          id="name"
          label="BOM 名称"
          disabled={pending}
          error={errs.name?.[0]}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="productId">产品</Label>
            <PendingLink
              href="/owner/products/new"
              pending={pending}
              className="text-xs text-primary hover:underline"
            >
              新建产品
            </PendingLink>
          </div>
          <select
            id="productId"
            name="productId"
            className={selectClass}
            defaultValue=""
            disabled={pending || targetType !== 'PRODUCT' || missingProducts}
          >
            <option value="">请选择产品</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.code ? `${product.code} · ` : ''}
                {product.name}（{product.categoryName}）
              </option>
            ))}
          </select>
          {errs.productId?.[0] ? (
            <p className="text-sm text-destructive">{errs.productId[0]}</p>
          ) : null}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="categoryNodeId">产品分类</Label>
            <PendingLink
              href="/owner/product-categories/new"
              pending={pending}
              className="text-xs text-primary hover:underline"
            >
              新建分类
            </PendingLink>
          </div>
          <select
            id="categoryNodeId"
            name="categoryNodeId"
            className={selectClass}
            defaultValue=""
            disabled={pending || targetType !== 'CATEGORY' || missingCategories}
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

      {missingTarget ? (
        <p className="text-sm text-muted-foreground">
          {targetType === 'PRODUCT'
            ? '暂无可用产品，请先创建并启用产品。'
            : '暂无可用产品分类，请先创建并启用分类。'}
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <TextField
          id="version"
          label="版本号"
          defaultValue="1"
          disabled={pending}
          error={errs.version?.[0]}
        />
        <TextField
          id="baseQuantity"
          label="基准产量"
          defaultValue="1"
          disabled={pending}
          error={errs.baseQuantity?.[0]}
        />
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">物料行</h2>
          <Button
            type="button"
            variant="outline"
            disabled={pending || rows.length >= 20}
            onClick={() =>
              setRows((current) => [
                ...current,
                { key: Math.max(...current.map((row) => row.key)) + 1 },
              ])
            }
          >
            添加物料
          </Button>
        </div>
        {errs.items?.[0] ? (
          <p className="text-sm text-destructive">{errs.items[0]}</p>
        ) : null}
        <div className="space-y-3">
          {rows.map((row, index) => (
            <div key={row.key} className="rounded-lg border p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">#{index + 1}</span>
                {rows.length > 1 ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      setRows((current) => current.filter((item) => item.key !== row.key))
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
                    {index === 0 ? (
                      <PendingLink
                        href="/owner/materials/new"
                        pending={pending}
                        className="text-xs text-primary hover:underline"
                      >
                        新建物料
                      </PendingLink>
                    ) : null}
                  </div>
                  <select
                    id={`items.${index}.materialId`}
                    name={`items.${index}.materialId`}
                    className={selectClass}
                    defaultValue=""
                    disabled={pending || missingMaterials}
                  >
                    <option value="">请选择物料</option>
                    {materials.map((material) => (
                      <option key={material.id} value={material.id}>
                        {material.code} · {material.name}（{material.unit}）
                      </option>
                    ))}
                  </select>
                </div>
                <TextField
                  id={`items.${index}.quantity`}
                  name={`items.${index}.quantity`}
                  label="用量"
                  disabled={pending}
                />
                <TextField
                  id={`items.${index}.remark`}
                  name={`items.${index}.remark`}
                  label="备注"
                  disabled={pending}
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
        <Button type="submit" disabled={pending || missingTarget || missingMaterials}>
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
  defaultValue,
  disabled,
}: {
  id: string;
  name?: string;
  label: string;
  error?: string | undefined;
  defaultValue?: string;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        defaultValue={defaultValue}
        disabled={disabled}
        aria-invalid={Boolean(error)}
      />
      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : null}
    </div>
  );
}
