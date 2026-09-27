'use client';

import type { SupplementContext } from '@/lib/form-drafts/model';
import { supplementReturnHref } from '@/lib/form-drafts/return-context';
import { SupplementFields } from '@/components/business/form-drafts/FormDraftControls';

import Link from 'next/link';
import { useActionState, useState, type ChangeEvent } from 'react';
import { ReceiverAddressPasteField } from '@/components/business/order/ReceiverAddressPasteField';
import { applyParsedReceiverFact, stripProvincePrefix } from '@/lib/order/receiver-address-paste';
import { PartyType } from '../../../generated/prisma/enums';
import type { PartyMutationResult } from '@/actions/owner-parties.types';
import { buttonVariants } from '@/components/ui/button';
import { Disclosure, DisclosureSummary } from '@/components/ui/disclosure';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  ActionNotice,
  FormErrorSummary,
  FormMessage,
  PendingButton,
  formMessageA11yProps,
  type FormErrorSummaryItem,
} from '@/components/ui-business';

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
      supplement?: SupplementContext | null;
    }
  | {
      mode: 'edit';
      supplement?: SupplementContext | null;
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

const PARTY_FIELD_LABELS: Record<string, string> = {
  type: '类型',
  code: '编码',
  name: '名称',
  shortName: '简称',
  primaryContactName: '联系人',
  primaryContactPhone: '联系电话',
  primaryContactWechat: '微信',
  defaultReceiverName: '收货人',
  defaultReceiverPhone: '收货电话',
  defaultProvince: '省份',
  defaultCity: '城市',
  defaultDistrict: '区县',
  defaultAddressDetail: '详细地址',
};

export function PartyForm(props: Props) {
  const [state, formAction, pending] = useActionState<
    PartyMutationResult | null,
    FormData
  >(props.action, null);

  const initial = props.mode === 'edit' ? props.initial : undefined;
  // Default delivery address: a pasted receiver string fills the four fields;
  // the paste box itself carries no `name`, so only the fields are submitted.
  const [receiverPaste, setReceiverPaste] = useState('');
  const [receiverDefaults, setReceiverDefaults] = useState({
    name: initial?.defaultReceiverName ?? '',
    phone: initial?.defaultReceiverPhone ?? '',
    province: initial?.defaultProvince ?? '',
    city: initial?.defaultCity ?? '',
    district: initial?.defaultDistrict ?? '',
    detail: initial?.defaultAddressDetail ?? '',
  });
  const bindReceiver = (key: keyof typeof receiverDefaults) => ({
    value: receiverDefaults[key],
    onChange: (event: ChangeEvent<HTMLInputElement>) =>
      setReceiverDefaults((current) => ({ ...current, [key]: event.target.value })),
  });
  const initialType =
    props.mode === 'create'
      ? (props.initialType ?? PartyType.CUSTOMER)
      : props.initial.type;
  const supplement = props.supplement;
  const backHref = supplement ? supplementReturnHref(supplement) :
    props.mode === 'create' && props.returnTo
      ? props.returnTo
      : '/owner/parties';
  const visibleState = pending ? null : state;
  const errs = visibleState?.status === 'invalid' ? visibleState.fieldErrors : {};
  const generalError = visibleState?.status === 'error' ? visibleState.message : null;
  const success = visibleState?.status === 'success';
  const summaryErrors = toPartyErrorSummary(errs);

  return (
    <form
      action={formAction}
      onReset={(event) => event.preventDefault()}
      aria-busy={pending}
      className="space-y-6"
      noValidate
    >
      {props.mode === 'create' && props.returnTo ? (
        <input type="hidden" name="returnTo" value={props.returnTo} />
      ) : null}
      <SupplementFields context={supplement} />
      <FormErrorSummary errors={summaryErrors} />

      <section className="space-y-4">
        <h2 className="text-base font-semibold">基本信息</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="type">类型</Label>
            <select
              id="type"
              name="type"
              {...(errs.type?.[0]
                ? formMessageA11yProps('type', 'error')
                : {})}
              className={selectClass}
              defaultValue={initialType}
              disabled={pending}
            >
              {PARTY_TYPE_OPTIONS.filter((option) => !supplement || props.mode === 'edit' || option.value !== 'CUSTOMER').map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {errs.type?.[0] ? (
              <FormMessage fieldId="type" tone="error">
                {errs.type[0]}
              </FormMessage>
            ) : null}
          </div>

          {props.mode === 'create' ? (
            <Disclosure
              className="rounded-lg border border-dashed p-3 md:col-span-2"
              open={Boolean(errs.code?.[0])}
            >
              <DisclosureSummary className="text-muted-foreground">
                高级设置：自定义客户/供应商编码（通常无需填写）
              </DisclosureSummary>
              <div className="mt-3">
                <TextField
                  id="code"
                  label="自定义编码（选填）"
                  hint="留空将自动生成，例如 PTY-000001。"
                  disabled={pending}
                  error={errs.code?.[0]}
                />
              </div>
            </Disclosure>
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
        <ReceiverAddressPasteField
          id="defaultReceiverPaste"
          label="粘贴收货信息（自动识别收货人、电话、省份和详细地址）"
          disabled={pending}
          value={receiverPaste}
          onChange={(next, parsed, source) => {
            setReceiverPaste(next);
            // The four persisted fields are joined verbatim downstream. A pasted
            // full address (one that names a province) replaces the whole
            // structured address: city and district are cleared and the
            // province is not repeated in detail. A street-only paste keeps them.
            const replacing = source === 'paste' && Boolean(parsed.province);
            setReceiverDefaults((current) => ({
              name: applyParsedReceiverFact(current.name, parsed.receiverName, source),
              phone: applyParsedReceiverFact(current.phone, parsed.receiverPhone, source),
              province: applyParsedReceiverFact(current.province, parsed.province, source),
              city: replacing ? '' : current.city,
              district: replacing ? '' : current.district,
              detail: applyParsedReceiverFact(current.detail, stripProvincePrefix(parsed.address, parsed.province) || null, source),
            }));
          }}
        />
        <div className="grid gap-4 md:grid-cols-2">
          <TextField
            id="defaultReceiverName"
            label="收货人"
            disabled={pending}
            error={errs.defaultReceiverName?.[0]}
            {...bindReceiver('name')}
          />
          <TextField
            id="defaultReceiverPhone"
            label="收货电话"
            disabled={pending}
            error={errs.defaultReceiverPhone?.[0]}
            {...bindReceiver('phone')}
          />
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <TextField
            id="defaultProvince"
            label="省份"
            disabled={pending}
            error={errs.defaultProvince?.[0]}
            {...bindReceiver('province')}
          />
          <TextField
            id="defaultCity"
            label="城市"
            disabled={pending}
            error={errs.defaultCity?.[0]}
            {...bindReceiver('city')}
          />
          <TextField
            id="defaultDistrict"
            label="区县"
            disabled={pending}
            error={errs.defaultDistrict?.[0]}
            {...bindReceiver('district')}
          />
        </div>
        <TextField
          id="defaultAddressDetail"
          label="详细地址"
          disabled={pending}
          error={errs.defaultAddressDetail?.[0]}
          {...bindReceiver('detail')}
        />
      </section>

      {generalError ? (
        <ActionNotice
          tone="error"
          title="客户/供应商保存失败"
          description={generalError}
        />
      ) : null}
      {success ? (
        <ActionNotice tone="success" title="客户/供应商已保存" />
      ) : null}

      <div className="flex flex-wrap gap-3">
        <PendingButton pending={pending} pendingLabel="正在保存客户/供应商…">
          {props.mode === 'create' ? '创建客户/供应商' : '保存修改'}
        </PendingButton>
        <Link href={backHref} className={buttonVariants({ variant: 'outline' })}>
          {supplement ? '返回原录入' : props.mode === 'create' && props.returnTo ? '返回采购单' : '返回列表'}
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
  value?: string;
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={id}
        type={type}
        {...(error
          ? formMessageA11yProps(id, 'error')
          : hint
            ? formMessageA11yProps(id, 'hint')
            : {})}
        {...inputProps}
      />
      {error ? (
        <FormMessage fieldId={id} tone="error">
          {error}
        </FormMessage>
      ) : hint ? (
        <FormMessage fieldId={id} tone="hint" className="text-xs">
          {hint}
        </FormMessage>
      ) : null}
    </div>
  );
}

function toPartyErrorSummary(
  fieldErrors: Record<string, string[]>,
): FormErrorSummaryItem[] {
  return Object.entries(fieldErrors).flatMap(([fieldId, messages]) =>
    messages.map((message) => ({
      fieldId,
      label: PARTY_FIELD_LABELS[fieldId] ?? '表单内容',
      message,
    })),
  );
}
