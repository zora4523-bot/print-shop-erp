'use client';

import { useActionState, useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ActionNotice, FormErrorSummary, FormMessage, PendingButton, formMessageA11yProps } from '@/components/ui-business';
import type { MaterialMutationResult } from '@/actions/owner-materials.types';

export function NewCatalogPaperForm({ action }: {
  action: (prev: MaterialMutationResult | null, data: FormData) => Promise<MaterialMutationResult>;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const [name, setName] = useState('');
  const [weight, setWeight] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (reviewing) reviewHeading.current?.focus(); }, [reviewing]);
  const errors = !pending && state?.status === 'invalid' ? state.fieldErrors : {};
  return <form action={formAction} aria-busy={pending} className="space-y-4">
    <FormErrorSummary errors={Object.entries(errors).flatMap(([fieldId, messages]) => messages.map((message) => ({ fieldId, label: fieldId === 'name' ? '纸张名称' : '克重', message })))} />
    <div className="space-y-2"><Label htmlFor="name">纸张名称</Label>
      <Input id="name" name="name" value={name} onChange={(event) => setName(event.target.value)} readOnly={reviewing} disabled={pending} required maxLength={60} {...(errors.name ? formMessageA11yProps('name', 'error') : {})} />
      {errors.name ? <FormMessage fieldId="name" tone="error">{errors.name[0]}</FormMessage> : null}
    </div>
    <div className="space-y-2"><Label htmlFor="weight">克重（g）</Label>
      <Input id="weight" name="weight" type="number" value={weight} onChange={(event) => setWeight(event.target.value)} readOnly={reviewing} disabled={pending} required min={1} max={2000} step={1} {...(errors.weight ? formMessageA11yProps('weight', 'error') : {})} />
      {errors.weight ? <FormMessage fieldId="weight" tone="error">{errors.weight[0]}</FormMessage> : null}
    </div>
    {reviewing ? <section className="space-y-3 rounded-lg border p-4" aria-label="新建纸张复核">
      <h2 ref={reviewHeading} tabIndex={-1} className="font-semibold">新建 {weight}g {name}</h2>
      <p className="text-sm">创建后纸张默认启用，单位为张，并进入专版纸张选项。空白封规格需另行启用。</p>
      <p className="text-sm">专版非基准纸缺少唯一加价时转人工核价；冰白纸由管理员核价。</p>
      <input type="hidden" name="reviewed" value="yes" />
      <div className="flex gap-3"><PendingButton pending={pending} pendingLabel="正在创建纸张…">创建纸张</PendingButton>
        <Button type="button" variant="outline" disabled={pending} onClick={() => setReviewing(false)}>返回修改</Button></div>
    </section> : <Button type="button" disabled={!name.trim() || !weight} onClick={() => setReviewing(true)}>复核新纸张</Button>}
    {!pending && state?.status === 'error' ? <ActionNotice tone="error" title="纸张创建失败" description={state.message} /> : null}
  </form>;
}
