import { ORDER_FORM_STEP_LABELS, type OrderFormGap, type OrderFormStep } from './order-form-gaps';
import { Button } from '@/components/ui/button';

export function OrderFormRail({
  itemCount,
  totalQuantity,
  settlementLabel,
  gaps,
  onJump,
}: {
  itemCount: number;
  totalQuantity: number;
  settlementLabel: string;
  gaps: readonly OrderFormGap[];
  onJump: (gap: OrderFormGap) => void;
}) {
  return (
    <aside className="hidden min-w-0 space-y-3 xl:sticky xl:top-20 xl:block xl:max-h-[calc(100dvh-6rem)] xl:self-start xl:overflow-y-auto xl:overscroll-contain xl:pr-1">
      <section className="rounded-xl border bg-card p-3 shadow-sm">
        <h2 className="text-sm font-semibold">本单摘要</h2>
        <dl className="mt-2 space-y-1.5 text-sm">
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">结算</dt>
            <dd className="font-medium">{settlementLabel}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">款式</dt>
            <dd className="font-sans tabular-nums">{itemCount}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">总数量</dt>
            <dd className="font-sans tabular-nums">
              {totalQuantity.toLocaleString()}
            </dd>
          </div>
        </dl>
        <p className="mt-2 border-t pt-2 text-[11px] text-muted-foreground">
          金额以提交后服务端核价为准，此处为预览。
        </p>
      </section>
      <section className="rounded-xl border border-destructive/30 bg-card p-3 shadow-sm">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">缺口清单</h2>
          <span className="rounded-full bg-destructive/10 px-2 py-0.5 font-sans text-xs tabular-nums text-destructive">
            {gaps.length}
          </span>
        </div>
        {gaps.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">没有阻断缺口，可以创建草稿。</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {gaps.map((gap) => (
              <li key={gap.id}>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onJump(gap)}
                  className="h-auto min-h-11 w-full min-w-0 items-start justify-start gap-2 whitespace-normal rounded-lg px-2 py-1.5 text-left text-xs"
                >
                  <span className="shrink-0 text-muted-foreground">
                    {ORDER_FORM_STEP_LABELS[gap.step as OrderFormStep]}
                  </span>
                  <span>{gap.label}</span>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}
