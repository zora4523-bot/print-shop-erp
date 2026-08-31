'use client';

import { useId, useState, type RefObject } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { FormMessage, formMessageA11yProps } from './FormMessage';

export type ConfirmActionLevel = 'L2' | 'L3';

export type ConfirmActionDialogProps = {
  level: ConfirmActionLevel;
  /** 必须是能接收 ref 的单一交互元素，例如 Button；关闭后焦点回到这里。 */
  trigger?: React.ReactElement;
  title: string;
  description: React.ReactNode;
  impactItems: readonly string[];
  confirmLabel: string;
  cancelLabel?: string;
  /** 关联外部表单；确认按钮会作为该表单的 submitter。 */
  formId?: string;
  disabled?: boolean;
  reasonLabel?: string;
  reasonName?: string;
  reasonPlaceholder?: string;
  onConfirm?: (reason: string | null) => void;
  className?: string;
  /** 用于 showcase / 契约测试；正常业务入口保持 false。 */
  defaultOpen?: boolean;
  /** 无触发器的受控模式，适合先拦截导航再打开确认层。 */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** 受控模式关闭后显式恢复焦点。普通 trigger 模式由 Base UI 自动处理。 */
  focusReturnRef?: RefObject<HTMLElement | null>;
};

export function confirmationCanSubmit(
  level: ConfirmActionLevel,
  reason: string,
): boolean {
  return level === 'L2' || reason.trim().length > 0;
}

/**
 * L2 用于需要先看影响范围的操作；L3 在此基础上强制填写理由。
 * AlertDialog 负责焦点圈定、Escape/遮罩策略与关闭后的触发器焦点恢复。
 */
export function ConfirmActionDialog({
  level,
  trigger,
  title,
  description,
  impactItems,
  confirmLabel,
  cancelLabel = '取消',
  formId,
  disabled = false,
  reasonLabel = '操作理由',
  reasonName = 'reason',
  reasonPlaceholder = '请说明执行此操作的业务原因',
  onConfirm,
  className,
  defaultOpen = false,
  open,
  onOpenChange,
  focusReturnRef,
}: ConfirmActionDialogProps) {
  const reasonId = useId();
  const [reason, setReason] = useState('');
  const reasonRequired = level === 'L3';
  const canSubmit = confirmationCanSubmit(level, reason) && !disabled;

  return (
    <>
      <AlertDialog
        {...(open === undefined ? { defaultOpen } : { open })}
        onOpenChange={(nextOpen) => {
          // 打开时立即清空；关闭时等当前 click/submit 默认动作完成后再清。
          // 这样外部 form 仍能读取本次理由，同时 Escape/取消不会留下可被
          // 后续 Enter 提交复用的陈旧 hidden value。
          if (nextOpen) setReason('');
          onOpenChange?.(nextOpen);
          if (!nextOpen) {
            window.requestAnimationFrame(() => {
              setReason('');
              focusReturnRef?.current?.focus();
            });
          }
        }}
      >
        {trigger ? (
          <AlertDialogTrigger render={trigger} type="button" disabled={disabled} />
        ) : null}
        <AlertDialogContent
          data-level={level}
          className={cn('max-w-xl', className)}
        >
          <AlertDialogHeader>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  'rounded-full border px-2 py-0.5 text-xs font-medium',
                  level === 'L3'
                    ? 'border-destructive/40 bg-destructive/10 text-destructive'
                    : 'border-warning/40 bg-warning/10 text-warning-foreground',
                )}
              >
                {level === 'L3' ? '高风险操作' : '请确认影响范围'}
              </span>
              <AlertDialogTitle>{title}</AlertDialogTitle>
            </div>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>

          <section aria-labelledby={`${reasonId}-impact-heading`} className="space-y-2">
            <h3 id={`${reasonId}-impact-heading`} className="text-sm font-medium">
              执行后会发生
            </h3>
            {impactItems.length > 0 ? (
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {impactItems.map((item) => (
                  <li key={item} className="admin-wrap-anywhere">
                    {item}
                  </li>
                ))}
              </ul>
            ) : (
              <p role="alert" className="text-sm text-destructive">
                影响范围缺失，暂不能确认此操作。
              </p>
            )}
          </section>

          {reasonRequired ? (
            <div className="space-y-1">
              <label htmlFor={reasonId} className="text-sm font-medium">
                {reasonLabel}
                <span className="ml-1 text-destructive" aria-hidden>
                  *
                </span>
              </label>
              <Textarea
                id={reasonId}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder={reasonPlaceholder}
                maxLength={500}
                required
                {...formMessageA11yProps(reasonId, 'hint')}
              />
              <FormMessage fieldId={reasonId}>
                理由会随本次操作提交并用于审计，最多 500 个字符。
              </FormMessage>
            </div>
          ) : null}

          <AlertDialogFooter>
            <AlertDialogCancel type="button">{cancelLabel}</AlertDialogCancel>
            <AlertDialogAction
              type={formId ? 'submit' : 'button'}
              form={formId}
              variant={level === 'L3' ? 'destructive' : 'default'}
              disabled={!canSubmit || impactItems.length === 0}
              onClick={() => onConfirm?.(reason.trim() || null)}
            >
              {confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {reasonRequired && formId ? (
        <input
          type="hidden"
          name={reasonName}
          form={formId}
          value={reason.trim()}
        />
      ) : null}
    </>
  );
}
