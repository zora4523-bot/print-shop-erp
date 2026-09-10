'use client';

import { useId, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { PreparedDesignFile } from '../design-upload-client';
import { LocalDesignImagePreview } from '../LocalDesignImagePreview';

export type OrderSubmissionReviewFact = {
  label: string;
  critical?: boolean;
};

export type OrderSubmissionReviewArtwork = {
  name: string;
  meta?: string;
  missing?: boolean;
  previewImage?: PreparedDesignFile;
};

export type OrderSubmissionReviewItem = {
  id: string;
  number: number;
  quantityLabel: string;
  quantityInWords?: string;
  quantityUnit?: string;
  quantityDetail?: string;
  specification: string;
  dimensions?: string;
  materialSummary: string;
  specificationWarning?: string;
  processSummary: ReactNode;
  facts?: readonly OrderSubmissionReviewFact[];
  artwork: OrderSubmissionReviewArtwork;
  amountLabel: string;
  manualQuoteReasons?: readonly string[];
};

export type OrderSubmissionReviewReceiver = {
  name: string;
  phone: string;
  address: string;
};

export type OrderSubmissionReviewCharge = {
  label: string;
  amountLabel: string;
  detail?: string;
  note?: string;
};

export type OrderSubmissionReviewContentProps = {
  orderName: string;
  items: readonly OrderSubmissionReviewItem[];
  receiver: OrderSubmissionReviewReceiver;
  cartonCharge?: OrderSubmissionReviewCharge;
  shippingCharge: OrderSubmissionReviewCharge;
  totalLabel: string;
  totalRequiresManualQuote?: boolean;
  totalNote?: string;
  headingHint?: string;
  backLabel?: string;
  confirmLabel?: string;
  confirmPendingLabel?: string;
  confirmPending?: boolean;
  confirmDisabled?: boolean;
  className?: string;
  onBack: () => void;
  onConfirm: () => void;
};

export type OrderSubmissionReviewDialogProps =
  OrderSubmissionReviewContentProps & {
    open: boolean;
    onOpenChange: (open: boolean) => void;
  };

function ReviewWarning({ children }: { children: ReactNode }) {
  return (
    <p className="mt-2 flex items-start gap-1.5 text-xs font-semibold leading-relaxed text-destructive">
      <span
        aria-hidden="true"
        className="mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-full bg-destructive text-xs text-background"
      >
        ?
      </span>
      <span>{children}</span>
    </p>
  );
}

export function OrderSubmissionReviewContent({
  orderName,
  items,
  receiver,
  cartonCharge,
  shippingCharge,
  totalLabel,
  totalRequiresManualQuote = false,
  totalNote,
  headingHint = '重点核对数量与规格。',
  backLabel = '返回修改',
  confirmLabel = '确认无误，提交',
  confirmPendingLabel = '提交中…',
  confirmPending = false,
  confirmDisabled = false,
  className,
  onBack,
  onConfirm,
}: OrderSubmissionReviewContentProps) {
  const headingId = useId();
  const multiItem = items.length > 1;

  return (
    <div
      data-slot="order-submission-review"
      aria-labelledby={headingId}
      className={cn(
        'flex min-h-0 flex-1 flex-col overflow-hidden bg-card text-card-foreground',
        className,
      )}
    >
      <header className="shrink-0 border-b px-5 pb-4 pt-5 sm:px-6">
        <p className="text-xs font-semibold tracking-[0.2em] text-muted-foreground">
          提交前复核
        </p>
        <h2
          id={headingId}
          className="mt-1.5 text-xl font-bold tracking-tight sm:text-2xl"
        >
          {orderName}
        </h2>
        <p className="mt-1.5 text-sm text-muted-foreground">{headingHint}</p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
        {items.map((item) => {
          const manualQuote = Boolean(item.manualQuoteReasons?.length);
          return (
            <section
              key={item.id}
              aria-labelledby={`${headingId}-${item.id}`}
              className="mb-6 last:mb-0"
            >
              <h3
                id={`${headingId}-${item.id}`}
                className="mb-3 border-b pb-2 text-xs font-semibold tracking-[0.18em] text-muted-foreground"
              >
                {multiItem
                  ? `第 ${item.number} 款 / 共 ${items.length} 款`
                  : '请重点核对这两项'}
              </h3>

              <div className="mb-4 grid grid-cols-1 gap-4 min-[480px]:grid-cols-2">
                <div
                  className="rounded-xl border-2 border-foreground p-3.5"
                >
                  <p className="text-xs font-bold tracking-[0.18em] text-muted-foreground">
                    数量
                  </p>
                  <p className="mt-1 text-3xl font-bold leading-none tracking-tight">
                    {item.quantityLabel}
                    <span className="ml-1 text-sm font-semibold tracking-normal">
                      {item.quantityUnit ?? '个'}
                    </span>
                  </p>
                  {item.quantityInWords ? (
                    <p className="mt-1.5 text-sm font-semibold tracking-wide">
                      {item.quantityInWords}
                    </p>
                  ) : null}
                  {item.quantityDetail ? (
                    <p className="mt-1 text-xs font-medium text-muted-foreground">
                      {item.quantityDetail}
                    </p>
                  ) : null}
                </div>

                <div
                  data-review-warning={
                    item.specificationWarning ? 'specification' : undefined
                  }
                  className={cn(
                    'rounded-xl border-2 border-foreground p-3.5',
                    item.specificationWarning &&
                      'border-destructive bg-destructive/5',
                  )}
                >
                  <p className="text-xs font-bold tracking-[0.18em] text-muted-foreground">
                    规格
                  </p>
                  <p className="mt-1 text-3xl font-bold leading-none tracking-tight">
                    {item.specification}
                  </p>
                  {item.dimensions ? (
                    <p className="mt-1.5 text-sm font-semibold tracking-wide">
                      {item.dimensions}
                    </p>
                  ) : null}
                  <p className="mt-1 text-xs font-medium leading-relaxed text-muted-foreground">
                    {item.materialSummary}
                  </p>
                  {item.specificationWarning ? (
                    <ReviewWarning>{item.specificationWarning}</ReviewWarning>
                  ) : null}
                </div>
              </div>

              <div className="border-t pt-3 text-sm leading-relaxed text-muted-foreground">
                {item.processSummary}
              </div>
              {item.facts && item.facts.length > 0 ? (
                <ul className="mt-3 flex flex-wrap gap-2" aria-label="工艺确认项">
                  {item.facts.map((fact) => (
                    <li
                      key={fact.label}
                      className={cn(
                        'rounded-md border border-dashed px-2.5 py-1 text-xs font-semibold text-muted-foreground',
                        fact.critical &&
                          'border-solid border-destructive text-destructive',
                      )}
                    >
                      {fact.label}
                    </li>
                  ))}
                </ul>
              ) : null}

              <div className="mt-3 flex items-start gap-3 border-y py-3">
                <span className="mt-2 flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-bold text-background">
                  {item.number}
                </span>
                <div
                  className={cn(
                    'flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md text-xs font-bold',
                    item.artwork.missing
                      ? 'bg-muted text-destructive'
                      : 'bg-primary text-primary-foreground',
                  )}
                >
                  {item.artwork.previewImage ? (
                    <LocalDesignImagePreview
                      image={item.artwork.previewImage}
                      alt={`第 ${item.number} 款设计图预览：${item.artwork.name}`}
                    />
                  ) : item.artwork.missing ? (
                    '缺图'
                  ) : (
                    <span
                      aria-hidden="true"
                      className="h-3 w-4 rounded-sm bg-background/70"
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-semibold leading-snug">
                    {item.artwork.name}
                  </p>
                  {item.artwork.meta ? (
                    <p
                      className={cn(
                        'mt-1 text-xs text-muted-foreground',
                        item.artwork.missing && 'text-destructive',
                      )}
                    >
                      {item.artwork.meta}
                    </p>
                  ) : null}
                </div>
                <p
                  className={cn(
                    'shrink-0 pt-2 text-sm font-bold tabular-nums',
                    manualQuote && 'text-xs text-destructive',
                  )}
                >
                  {item.amountLabel}
                </p>
              </div>
              {manualQuote ? (
                <div className="mt-3 border-l-4 border-destructive bg-destructive/5 px-3 py-2 text-xs font-semibold leading-relaxed text-destructive">
                  人工核价：{item.manualQuoteReasons?.join('；')}
                </div>
              ) : null}
            </section>
          );
        })}

        <section aria-labelledby={`${headingId}-shipping`} className="mt-6">
          <h3
            id={`${headingId}-shipping`}
            className="mb-3 border-b pb-2 text-xs font-semibold tracking-[0.18em] text-muted-foreground"
          >
            收货与快递
          </h3>
          <address className="not-italic">
            <p className="text-xs font-medium text-muted-foreground">
              {receiver.name} · {receiver.phone}
            </p>
            <p className="mt-1 text-sm font-semibold leading-relaxed">
              {receiver.address}
            </p>
          </address>
          <dl className="mt-3 divide-y border-y text-sm">
            {cartonCharge ? (
              <div className="flex items-start justify-between gap-4 py-2.5">
                <dt className="text-muted-foreground">
                  {cartonCharge.label}
                  {cartonCharge.detail ? ` · ${cartonCharge.detail}` : ''}
                </dt>
                <dd className="shrink-0 font-semibold tabular-nums">
                  {cartonCharge.amountLabel}
                </dd>
              </div>
            ) : null}
            <div className="flex items-start justify-between gap-4 py-2.5">
              <dt className="text-muted-foreground">
                {shippingCharge.label}
                {shippingCharge.detail ? ` · ${shippingCharge.detail}` : ''}
                {shippingCharge.note ? (
                  <span className="mt-1 block text-xs">
                    {shippingCharge.note}
                  </span>
                ) : null}
              </dt>
              <dd className="shrink-0 font-semibold tabular-nums">
                {shippingCharge.amountLabel}
              </dd>
            </div>
          </dl>
        </section>

        <div className="mt-4 flex items-baseline justify-between gap-4 border-t-2 border-foreground pt-4">
          <span className="text-xs font-semibold text-muted-foreground">合计</span>
          <strong
            className={cn(
              'text-right text-2xl font-bold tracking-tight tabular-nums',
              'whitespace-pre-line',
              totalRequiresManualQuote &&
                'max-w-xs text-sm leading-relaxed text-destructive',
            )}
          >
            {totalLabel}
          </strong>
        </div>
        {totalNote ? (
          <p className="mt-2 text-xs text-muted-foreground">{totalNote}</p>
        ) : null}
      </div>

      <footer className="sticky bottom-0 grid shrink-0 grid-cols-[1fr_1.6fr] gap-2.5 border-t bg-card px-5 py-3.5 sm:px-6">
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={confirmPending}
          onClick={onBack}
        >
          {backLabel}
        </Button>
        <Button
          type="button"
          className={cn(
            'min-h-11 bg-foreground text-background hover:bg-foreground/90',
            totalRequiresManualQuote &&
              'bg-destructive text-background hover:bg-destructive/90',
          )}
          disabled={confirmDisabled || confirmPending}
          onClick={onConfirm}
        >
          {confirmPending ? confirmPendingLabel : confirmLabel}
        </Button>
      </footer>
    </div>
  );
}

export function OrderSubmissionReviewDialog({
  open,
  onOpenChange,
  onBack,
  ...contentProps
}: OrderSubmissionReviewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="left-1/2 top-4 flex max-h-[calc(100dvh-2rem)] max-w-2xl -translate-x-1/2 translate-y-0 flex-col gap-0 overflow-hidden p-0 sm:top-6"
      >
        <DialogTitle className="sr-only">
          提交前复核：{contentProps.orderName}
        </DialogTitle>
        <DialogDescription className="sr-only">
          重点核对数量、规格、文件和收货信息。
        </DialogDescription>
        <OrderSubmissionReviewContent
          {...contentProps}
          onBack={() => {
            onBack();
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
