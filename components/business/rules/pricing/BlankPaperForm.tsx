'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { addBlankPaperAction } from '@/actions/blank-paper';
import {
  BLANK_SPECIFICATIONS,
  type AddBlankPaperResult,
} from '@/lib/price/blank-paper';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';

export function BlankPaperForm({
  priceBookId,
  expectedUpdatedAt,
  papers,
}: {
  priceBookId: string;
  expectedUpdatedAt: string;
  papers: readonly { id: string; name: string }[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<'new' | 'existing'>(
    papers.length ? 'existing' : 'new',
  );
  const [result, action, pending] = useActionState(
    async (_previous: AddBlankPaperResult | null, form: FormData) => {
      return addBlankPaperAction({
        priceBookId,
        expectedUpdatedAt,
        paper:
          mode === 'existing'
            ? { mode, id: String(form.get('paperId') ?? '') }
            : {
                mode,
                name: String(form.get('paperName') ?? ''),
                weight: Number(form.get('weight')),
              },
        specifications: BLANK_SPECIFICATIONS.map((spec) => ({
          key: spec.key,
          amount: String(form.get(`price-${spec.key}`) ?? '').trim() || null,
        })),
      });
    },
    null,
  );
  useEffect(() => {
    if (result?.status === 'success') {
      router.push('/owner/rules/customer-pricing?section=blank');
      router.refresh();
    }
  }, [result, router]);
  return (
    <form
      action={action}
      aria-label="新建纸张与规格价格"
      aria-busy={pending}
      className="space-y-6 rounded-xl border bg-card p-5"
    >
      <fieldset disabled={pending} className="space-y-4">
        <legend className="mb-3 font-semibold">纸张</legend>
        <div className="flex flex-wrap gap-4">
          <label className="relative flex min-h-11 items-center gap-2">
            <input
              type="radio"
              className="peer absolute inset-0 size-full cursor-pointer opacity-0"
              name="paperMode"
              checked={mode === 'existing'}
              onChange={() => setMode('existing')}
              disabled={!papers.length}
            />
            <span
              aria-hidden="true"
              className="size-4 rounded-full border border-foreground peer-checked:bg-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2"
            />
            选择已有纸张
          </label>
          <label className="relative flex min-h-11 items-center gap-2">
            <input
              type="radio"
              className="peer absolute inset-0 size-full cursor-pointer opacity-0"
              name="paperMode"
              checked={mode === 'new'}
              onChange={() => setMode('new')}
            />
            <span
              aria-hidden="true"
              className="size-4 rounded-full border border-foreground peer-checked:bg-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2"
            />
            新建纸张
          </label>
        </div>
        {mode === 'existing' ? (
          <div className="space-y-2">
            <Label htmlFor="paperId">纸张</Label>
            <NativeSelect
              id="paperId"
              name="paperId"
              required
              defaultValue=""
            >
              <option value="" disabled>
                请选择纸张
              </option>
              {papers.map((paper) => (
                <option key={paper.id} value={paper.id}>
                  {paper.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_160px]">
            <div className="space-y-2">
              <Label htmlFor="paperName">纸张名称</Label>
              <Input id="paperName" name="paperName" required maxLength={60} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="weight">克重（g）</Label>
              <Input
                id="weight"
                name="weight"
                type="number"
                min={1}
                max={2000}
                step={1}
                required
              />
            </div>
          </div>
        )}
      </fieldset>
      <fieldset disabled={pending} className="space-y-3">
        <legend className="mb-3 font-semibold">
          规格单价（元 / 个）
        </legend>
        <p className="text-sm text-muted-foreground">
          单价最多四位小数。
        </p>
        {BLANK_SPECIFICATIONS.map((spec) => (
          <div
            key={spec.key}
            className="grid grid-cols-[minmax(0,1fr)_140px] items-center gap-4 border-b pb-3 last:border-b-0"
          >
            <Label htmlFor={`price-${spec.key}`}>{spec.label}</Label>
            <Input
              id={`price-${spec.key}`}
              name={`price-${spec.key}`}
              aria-label={`${spec.label}单价`}
              type="number"
              min={0}
              max="9999999999.9999"
              step="0.0001"
              placeholder="未启用"
              disabled={pending}
            />
          </div>
        ))}
      </fieldset>
      {result?.status === 'error' ? (
        <p role="alert" className="text-sm text-destructive">
          {result.message}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? '正在保存…' : '保存纸张与规格价格'}
      </Button>
    </form>
  );
}
