'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { PartyType } from '../../../generated/prisma/enums';
import type { PartyMutationResult } from '@/actions/owner-parties.types';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type PartyFormInitial = {
  type: PartyType;
  code: string;
  name: string;
  shortName: string | null;
  primaryContactName: string | null;
  primaryContactPhone: string | null;
  primaryContactWechat: string | null;
  defaultReceiverName: string | null;
  defaultReceiverPhone: string | null;
  defaultProvince: string | null;
  defaultCity: string | null;
  defaultDistrict: string | null;
  defaultAddressDetail: string | null;
};

type Props =
  | {
      mode: 'create';
      action: (
        prev: PartyMutationResult | null,
        fd: FormData,
      ) => Promise<PartyMutationResult>;
      initialType?: PartyType;
      returnTo?: '/owner/purchases/new';
    }
  | {
      mode: 'edit';
      action: (
        prev: PartyMutationResult | null,
        fd: FormData,
      ) => Promise<PartyMutationResult>;
      initial: PartyFormInitial;
    };

const PARTY_TYPE_OPTIONS = [
  { value: PartyType.CUSTOMER, label: '客户' },
  { value: PartyType.SUPPLIER, label: '供应商' },
  { value: PartyType.BOTH, label: '客户/供应商' },
] as const;

const selectClass =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50';

export function PartyForm(props: Props) {
  const [state, formAction, pending] = useActionState<
    PartyMutationResult | null,
    FormData
  >(props.action, null);

  const initial = props.mode === 'edit' ? props.initial : undefined;
  const initialType =
    props.mode === 'create'
      ? (props.initialType ?? PartyType.CUSTOMER)
      : props.initial.type;
  const backHref =
    props.mode === 'create' && props.returnTo
      ? props.returnTo
      : '/owner/parties';
  const errs = state?.status === 'invalid' ? state.fieldErrors : {};
  const generalError = state?.status === 'error' ? state.message : null;
  const success = state?.status === 'success';

  return (
    <form action={formAction} className="space-y-6" noValidate>
      {props.mode === 'create' && props.returnTo ? (
        <input type="hidden" name="returnTo" value={props.returnTo} />
      ) : null}
      <section className="space-y-4">
        <h2 className="text-base font-semibold">基本信息</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="type">类型</Label>
            <select
              id="type"
              name="type"
              className={selectClass}
              defaultValue={initialType}
              disabled={pending}
            >
              {PARTY_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {errs.type?.[0] ? (
              <p className="text-sm text-destructive">{errs.type[0]}</p>
            ) : null}
          </div>

          {props.mode === 'create' ? (
            <details
              className="rounded-lg border border-dashed p-3 md:col-span-2"
              open={Boolean(errs.code?.[0])}
            >
              <summary className="cursor-pointer text-sm text-muted-foreground">
                高级设置：自定义客户/供应商编码（通常无需填写）
              </summary>
              <div className="mt-3">
                <TextField
                  id="code"
                  label="自定义编码（选填）"
                  hint="留空将自动生成，例如 PTY-000001。"
                  disabled={pending}
                  error={errs.code?.[0]}
                />
              </div>
            </details>
          ) : (
            <TextField
              id="code"
              label="编码"
              hint="大小写不敏感；修改前请确认外部对接影响。"
              required
              disabled={pending}
              error={errs.code?.[0]}
              defaultValue={initial?.code ?? ''}
            />
          )}

          <TextField
            id="name"
            label="名称"
            required
            disabled={pending}
            error={errs.name?.[0]}
            defaultValue={initial?.name ?? ''}
          />

          <TextField
            id="shortName"
            label="简称（选填）"
            disabled={pending}
            error={errs.shortName?.[0]}
            defaultValue={initial?.shortName ?? ''}
          />
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-base font-semibold">默认联系人</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <TextField
            id="primaryContactName"
            label="联系人"
            disabled={pending}
            error={errs.primaryContactName?.[0]}
            defaultValue={initial?.primaryContactName ?? ''}
          />
          <TextField
            id="primaryContactPhone"
            label="联系电话"
            disabled={pending}
            error={errs.primaryContactPhone?.[0]}
            defaultValue={initial?.primaryContactPhone ?? ''}
          />
          <TextField
            id="primaryContactWechat"
            label="微信"
            disabled={pending}
            error={errs.primaryContactWechat?.[0]}
            defaultValue={initial?.primaryContactWechat ?? ''}
          />
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-base font-semibold">默认收货地址</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <TextField
            id="defaultReceiverName"
            label="收货人"
            disabled={pending}
            error={errs.defaultReceiverName?.[0]}
            defaultValue={initial?.defaultReceiverName ?? ''}
          />
          <TextField
            id="defaultReceiverPhone"
            label="收货电话"
            disabled={pending}
            error={errs.defaultReceiverPhone?.[0]}
            defaultValue={initial?.defaultReceiverPhone ?? ''}
          />
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <TextField
            id="defaultProvince"
            label="省份"
            disabled={pending}
            error={errs.defaultProvince?.[0]}
            defaultValue={initial?.defaultProvince ?? ''}
          />
          <TextField
            id="defaultCity"
            label="城市"
            disabled={pending}
            error={errs.defaultCity?.[0]}
            defaultValue={initial?.defaultCity ?? ''}
          />
          <TextField
            id="defaultDistrict"
            label="区县"
            disabled={pending}
            error={errs.defaultDistrict?.[0]}
            defaultValue={initial?.defaultDistrict ?? ''}
          />
        </div>
        <TextField
          id="defaultAddressDetail"
          label="详细地址"
          disabled={pending}
          error={errs.defaultAddressDetail?.[0]}
          defaultValue={initial?.defaultAddressDetail ?? ''}
        />
      </section>

      {generalError ? (
        <p role="alert" className="text-sm text-destructive">
          {generalError}
        </p>
      ) : null}
      {success ? (
        <p role="status" className="text-sm text-success-foreground">
          ✓ 已保存
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={pending}>
          {pending
            ? '提交中…'
            : props.mode === 'create'
              ? '创建客户/供应商'
              : '保存修改'}
        </Button>
        <Link href={backHref} className={buttonVariants({ variant: 'outline' })}>
          {props.mode === 'create' && props.returnTo ? '返回采购单' : '返回列表'}
        </Link>
      </div>
    </form>
  );
}

function TextField({
  id,
  label,
  hint,
  error,
  type = 'text',
  ...inputProps
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string | undefined;
  type?: string;
  required?: boolean;
  disabled?: boolean;
  defaultValue?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={id}
        type={type}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        {...inputProps}
      />
      {error ? (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
