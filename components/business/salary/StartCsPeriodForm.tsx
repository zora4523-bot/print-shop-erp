'use client';

import { useActionState, useTransition } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Link from 'next/link';
import { startCsPeriodAction } from '@/actions/owner-salary';
import type { StartCsPeriodResult } from '@/actions/owner-salary.types';

export type CsUserOption = {
  id: string;
  displayName: string;
  username: string;
};

type Props = {
  csUsers: CsUserOption[];
};

export function StartCsPeriodForm({ csUsers }: Props) {
  const [state, action] = useActionState<StartCsPeriodResult | null, unknown>(
    startCsPeriodAction,
    null,
  );
  const [pending, startTransition] = useTransition();
  const missingCsUsers = csUsers.length === 0;

  // startCsPeriodAction ends in redirect() on success, so the
  // useActionState 'success' branch is never observed in practice.

  return (
    <form
      action={(fd) => {
        const payload = {
          csUserId: String(fd.get('csUserId') ?? ''),
          periodStart: String(fd.get('periodStart') ?? ''),
          durationMonths: fd.get('durationMonths') || undefined,
          baseMonthsAlreadyPaid:
            fd.get('baseMonthsAlreadyPaid') || undefined,
          initialSales: fd.get('initialSales') || undefined,
          monthlyBase: fd.get('monthlyBase') || undefined,
        };
        startTransition(() => action(payload));
      }}
      className="space-y-4"
    >
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label className="text-xs text-muted-foreground" htmlFor="cs-user">客服 *</Label>
          <select
            name="csUserId"
            id="cs-user"
            className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
            defaultValue=""
            disabled={pending || missingCsUsers}
          >
            <option value="">{missingCsUsers ? '暂无可用客服' : '选择客服…'}</option>
            {csUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName}（{u.username}）
              </option>
            ))}
          </select>
          {errs(state, 'csUserId').length > 0 ? (
            <p className="mt-1 text-xs text-destructive">
              {errs(state, 'csUserId')[0]}
            </p>
          ) : null}
          {missingCsUsers ? (
            <p role="alert" className="mt-1 text-xs text-warning-foreground">
              暂无启用的客服账号，请先在用户管理中创建或启用客服。
            </p>
          ) : null}
        </div>

        <div>
          <Label className="text-xs text-muted-foreground" htmlFor="cs-period-start">周期起始日期 *</Label>
          <Input type="date" name="periodStart"
            id="cs-period-start" className="mt-1" />
          {errs(state, 'periodStart').length > 0 ? (
            <p className="mt-1 text-xs text-destructive">
              {errs(state, 'periodStart')[0]}
            </p>
          ) : null}
        </div>

        <div>
          <Label className="text-xs text-muted-foreground" htmlFor="cs-duration-months">
            周期月数（留空 = 按当前规则）
          </Label>
          <Input
            type="number"
            name="durationMonths"
            id="cs-duration-months"
            inputMode="numeric"
            min={1}
            max={24}
            placeholder="4"
            className="mt-1"
          />
          {errs(state, 'durationMonths').length > 0 ? (
            <p className="mt-1 text-xs text-destructive">
              {errs(state, 'durationMonths')[0]}
            </p>
          ) : null}
        </div>

        <div>
          <Label className="text-xs text-muted-foreground" htmlFor="cs-monthly-base">
            月底薪 (元)（留空 = 按当前规则）
          </Label>
          <Input
            type="text"
            name="monthlyBase"
            id="cs-monthly-base"
            inputMode="decimal"
            placeholder="2000"
            className="mt-1"
          />
          {errs(state, 'monthlyBase').length > 0 ? (
            <p className="mt-1 text-xs text-destructive">
              {errs(state, 'monthlyBase')[0]}
            </p>
          ) : null}
        </div>

        <div className="col-span-2">
          <Label className="text-xs text-muted-foreground" htmlFor="cs-initial-sales">
            期初业绩 (元) — 历史导入用，新客服留空
          </Label>
          <Input
            type="text"
            name="initialSales"
            id="cs-initial-sales"
            inputMode="decimal"
            placeholder="0"
            className="mt-1"
          />
          {errs(state, 'initialSales').length > 0 ? (
            <p className="mt-1 text-xs text-destructive">
              {errs(state, 'initialSales')[0]}
            </p>
          ) : null}
        </div>

        <div className="col-span-2">
          <Label className="text-xs text-muted-foreground" htmlFor="cs-base-months-paid">
            已发底薪月数 — 历史导入用，新客服留空
          </Label>
          <Input
            id="cs-base-months-paid"
            type="number"
            name="baseMonthsAlreadyPaid"
            inputMode="numeric"
            min={0}
            max={24}
            placeholder="0"
            className="mt-1"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            系统会按“月底薪 × 已发月数”生成一条期初工资发放流水。
          </p>
          {errs(state, 'baseMonthsAlreadyPaid').length > 0 ? (
            <p className="mt-1 text-xs text-destructive">
              {errs(state, 'baseMonthsAlreadyPaid')[0]}
            </p>
          ) : null}
        </div>
      </div>

      {state?.status === 'error' ? (
        <p role="alert" className="text-sm text-destructive">{state.message}</p>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending || missingCsUsers}>
          {pending ? '创建中…' : '创建周期'}
        </Button>
        <Link
          href={missingCsUsers ? '/owner/accounts/new' : '/owner/salary/cs'}
          className={buttonVariants({ variant: 'outline' })}
        >
          {missingCsUsers ? '新建客服账号' : '取消'}
        </Link>
      </div>
    </form>
  );
}

function errs(state: StartCsPeriodResult | null, name: string): string[] {
  if (!state || state.status !== 'invalid') return [];
  return state.fieldErrors[name] ?? [];
}
