'use client';

import { Children, isValidElement, createContext, useContext, useId, useState, type ReactElement, type RefObject } from 'react';
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

export type ConfirmActionControlProps = {
  level: ConfirmActionLevel;
  /** 必须是能接收 ref 的单一交互元素，例如 Button；关闭后焦点回到这里。 */
  trigger?: React.ReactElement;
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

/** Presentation accepts facts only. Interaction plumbing lives in a separate controller. */
export type ConfirmActionDialogProps = {
  action: string;
  changes: readonly { label: string; old: string; new: string }[];
  consequences: readonly string[];
  confirmText: string;
  danger?: boolean;
  /** Reject JSX children even when other props are spread (TypeScript excess-property loophole). */
  children?: never;
};

const ConfirmationControlContext = createContext<ConfirmActionControlProps | null>(null);

export function ConfirmActionController({ children, ...control }: ConfirmActionControlProps & {
  children: ReactElement<ConfirmActionDialogProps, typeof ConfirmActionDialog>;
}) {
  const content = Children.only(children);
  if (!isValidElement(content) || content.type !== ConfirmActionDialog) {
    throw new Error('ConfirmActionController accepts one ConfirmActionDialog only');
  }
  return <ConfirmationControlContext.Provider value={control}>{content}</ConfirmationControlContext.Provider>;
}

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
export function ConfirmActionDialog({ action, changes, consequences, confirmText, danger }: ConfirmActionDialogProps) {
  const control = useContext(ConfirmationControlContext);
  if (!control) throw new Error('ConfirmActionDialog requires ConfirmActionController');
  const {
    level, trigger, cancelLabel = '取消', formId, disabled = false,
    reasonLabel = '操作理由', reasonName = 'reason', reasonPlaceholder = '填写理由（最多 500 字）',
    onConfirm, className, defaultOpen = false, open, onOpenChange, focusReturnRef,
  } = control;
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
            <AlertDialogTitle>{action}</AlertDialogTitle>
            <AlertDialogDescription className="sr-only">核对本次变更后选择操作。</AlertDialogDescription>
          </AlertDialogHeader>
          {changes.length > 0 ? <dl className="space-y-2" aria-label="本次变更">
            {changes.map((change, index) => <div key={`${change.label}-${index}`} className="flex min-w-0 flex-wrap justify-between gap-2 text-sm">
              <dt>{change.label}</dt>
              <dd className="admin-wrap-anywhere"><span className="text-muted-foreground">{change.old}</span><span aria-label="变更为"> → </span><strong>{change.new}</strong></dd>
            </div>)}
          </dl> : null}
          {consequences.length > 0 ? <ul className="space-y-1 text-sm text-muted-foreground" aria-label="本次影响">
            {[...new Set(consequences)].map((item) => <li key={item} className="admin-wrap-anywhere">{item}</li>)}
          </ul> : null}
          {changes.length === 0 && consequences.length === 0 ? <p role="alert" className="text-sm text-destructive">未取得操作内容，请关闭后重试。</p> : null}

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
                必填，最多 500 个字符。
              </FormMessage>
            </div>
          ) : null}

          <AlertDialogFooter>
            <AlertDialogCancel type="button">{cancelLabel}</AlertDialogCancel>
            <AlertDialogAction
              type={formId ? 'submit' : 'button'}
              form={formId}
              variant={danger || level === 'L3' ? 'destructive' : 'default'}
              disabled={!canSubmit || (changes.length === 0 && consequences.length === 0)}
              onClick={() => onConfirm?.(reason.trim() || null)}
            >
              {confirmText}
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
