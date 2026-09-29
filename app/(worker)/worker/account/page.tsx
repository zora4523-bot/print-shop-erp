import Link from 'next/link';
import { requireSession } from '@/lib/auth/session';
import { getReporterOperationTypeOrNull } from '@/lib/production/operation-portal';
import { resolveReporterPieceworkRate } from '@/lib/salary/piecework-rate-selection';
import { PieceworkPricingError } from '@/lib/salary/piecework-pricing';
import { db } from '@/lib/db';
import { databaseClockNow } from '@/lib/background-jobs/clock';
import { formatUnitPrice } from '@/lib/format/unit-price';
import { REPORT_OPERATION_LABELS } from '@/lib/salary/report-display';
import { LogoutButton } from '@/components/business/auth/LogoutButton';
import { WORKER_TYPE_LABELS } from '@/lib/auth/role-labels';
import { PageHeader } from '@/components/ui-business';

export const metadata = { title: '我的账号' };
const RATE_UNITS = { PARTIAL: 'PER_PASS', FULL: 'PER_PIECE', PACKING: 'PER_BAG' } as const;
const UNIT_LABELS = { PARTIAL: '下', FULL: '个', PACKING: '袋' } as const;
export default async function WorkerAccountPage() {
  const { user } = await requireSession();
  const lane = await getReporterOperationTypeOrNull(user);
  let rate: Awaited<ReturnType<typeof resolveReporterPieceworkRate>> | null = null;
  let error = '';
  const workerLabel = user.workerType ? WORKER_TYPE_LABELS[user.workerType] : '师傅';
  if (lane) {
    try { rate = await resolveReporterPieceworkRate(db, user.id, lane, RATE_UNITS[lane], await databaseClockNow(db)); }
    catch (e) { if (!(e instanceof PieceworkPricingError)) throw e; error = e.message; }
  }
  return <div className="space-y-5"><PageHeader size="worker" title="我的账号" />
    <section className="space-y-2 rounded-xl border bg-card p-4"><h2 className="font-semibold">{user.displayName}</h2><p>{lane ? REPORT_OPERATION_LABELS[lane] : workerLabel}</p></section>
    {lane && <section className="space-y-3 rounded-xl border bg-card p-4"><h2 className="font-semibold">当前适用工价</h2>{error ? <p role="status">{error}</p> : rate && <><p>{rate.source === 'PERSONAL' ? '个人工价' : '统一工价'} · 第 {rate.book.version} 版</p><p>计件单价：{formatUnitPrice(rate.rule.amount.toString())}/{UNIT_LABELS[lane]}</p>{rate.rule.smallOrderAmount != null && rate.rule.setupAmount != null && <><p>小单（≤1000 个，含装版）：{formatUnitPrice(rate.rule.smallOrderAmount.toString())}/{lane === 'FULL' ? '色' : '次'}</p><p>大单装版费：{formatUnitPrice(rate.rule.setupAmount.toString())}/{lane === 'FULL' ? '色' : '次'}</p></>}</>}</section>}
    <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card p-4"><Link href="/account/password" className="inline-flex min-h-11 items-center underline">修改密码</Link><LogoutButton /></section>
  </div>;
}
