import { cn } from '@/lib/utils';

export type FormMessageTone = 'hint' | 'success' | 'error';

export type FormMessageProps = {
  /** 对应表单控件的 id；组件据此生成稳定的消息 id。 */
  fieldId: string;
  tone?: FormMessageTone;
  children: React.ReactNode;
  className?: string;
};

const MESSAGE_TONE_CLASS: Record<FormMessageTone, string> = {
  hint: 'text-muted-foreground',
  success: 'text-success-foreground',
  error: 'text-destructive',
};

/** 返回 FormMessage 使用的稳定 id，供控件的 aria-describedby 引用。 */
export function formMessageId(fieldId: string): string {
  return `${fieldId}-message`;
}

/**
 * 生成表单控件需要的 ARIA 关联属性。错误消息同时使用 aria-errormessage，
 * 但仍保留 aria-describedby 以覆盖尚未完整支持 aria-errormessage 的组合。
 */
export function formMessageA11yProps(
  fieldId: string,
  tone: FormMessageTone = 'hint',
) {
  const messageId = formMessageId(fieldId);
  if (tone === 'error') {
    return {
      'aria-describedby': messageId,
      'aria-errormessage': messageId,
      'aria-invalid': true as const,
    };
  }
  return { 'aria-describedby': messageId };
}

export function FormMessage({
  fieldId,
  tone = 'hint',
  children,
  className,
}: FormMessageProps) {
  const isSuccess = tone === 'success';

  return (
    <p
      id={formMessageId(fieldId)}
      data-slot="form-message"
      data-field-id={fieldId}
      data-tone={tone}
      // 字段错误通过 aria-errormessage 与控件关联；提交失败只由
      // FormErrorSummary assertive 播报一次，避免摘要 + N 个字段抢播报。
      role={isSuccess ? 'status' : undefined}
      aria-live={isSuccess ? 'polite' : undefined}
      aria-atomic={isSuccess ? 'true' : undefined}
      className={cn('text-sm', MESSAGE_TONE_CLASS[tone], className)}
    >
      {children}
    </p>
  );
}
