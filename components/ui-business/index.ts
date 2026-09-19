// 业务原子组件 barrel export——业务页面统一从 '@/components/ui-business'
// 引入，不要单独 deep-import 文件路径，方便未来重构。

export { StatCard } from './StatCard';
export type { StatCardProps, StatDelta } from './StatCard';

export { StatusBadge } from './StatusBadge';
export type { StatusBadgeProps } from './StatusBadge';

export { ActionShortcut } from './ActionShortcut';
export type { ActionShortcutProps } from './ActionShortcut';

export { NavCard } from './NavCard';
export type { NavCardProps } from './NavCard';

export { HeroBanner } from './HeroBanner';
export type { HeroBannerProps } from './HeroBanner';

export { PageHeader } from './PageHeader';
export type { PageHeaderProps } from './PageHeader';

export { EmptyState } from './EmptyState';
export type { EmptyStateKind, EmptyStateProps } from './EmptyState';
export {
  EMPTY_NO_ACCESS_ACTION,
  EMPTY_NO_ACCESS_DESCRIPTION,
  EMPTY_NO_ACCESS_HOME_HREF,
  EMPTY_NO_ACCESS_TITLE,
} from './empty-state-copy';

export { ContentSkeleton, SlowLoadingHint } from './ContentSkeleton';
export { SectionLoading } from './SectionLoading';
export type { SectionLoadingProps } from './SectionLoading';
export type {
  ContentSkeletonProps,
  ContentSkeletonVariant,
  SlowLoadingHintProps,
} from './ContentSkeleton';

export { ErrorBoundary } from './ErrorBoundary';
export type { ErrorBoundaryProps } from './ErrorBoundary';
export { ErrorState } from './ErrorState';
export type { ErrorStateProps, ErrorStateScope } from './ErrorState';

export { DisabledReason } from './DisabledReason';
export type { DisabledReasonCause, DisabledReasonProps } from './DisabledReason';

export { PendingButton } from './PendingButton';
export type { PendingButtonProps } from './PendingButton';
export { PendingLink } from './PendingLink';
export type { PendingLinkProps } from './PendingLink';

export { EnvNotice } from './EnvNotice';
export type { EnvNoticeProps } from './EnvNotice';

export { LongTaskReceipt, remainingHoursLabel } from './LongTaskReceipt';
export type {
  LongTaskReceiptHistoryItem,
  LongTaskReceiptProps,
  LongTaskReceiptStatus,
} from './LongTaskReceipt';

export { useCopyToClipboard, copyFeedbackMessage } from './useCopyToClipboard';
export type { CopyFeedback, CopyOptions } from './useCopyToClipboard';

export { TableScrollArea } from './TableScrollArea';
export type { TableScrollAreaProps } from './TableScrollArea';

export { ActionNotice } from './ActionNotice';
export type { ActionNoticeProps, ActionNoticeTone } from './ActionNotice';

export { ReceiptNotice } from './ReceiptNotice';
export type {
  ReceiptMessage,
  ReceiptMessageResolver,
  ReceiptNoticeProps,
} from './ReceiptNotice';

export {
  FormMessage,
  formMessageA11yProps,
  formMessageId,
} from './FormMessage';
export type { FormMessageProps, FormMessageTone } from './FormMessage';

export { FormErrorSummary } from './FormErrorSummary';
export type {
  FormErrorSummaryItem,
  FormErrorSummaryProps,
} from './FormErrorSummary';

export { BatchActionResult } from './BatchActionResult';
export type {
  BatchActionResultItem,
  BatchActionResultProps,
  BatchActionResultStatus,
} from './BatchActionResult';

export { ConflictResolutionPanel } from './ConflictResolutionPanel';
export type { ConflictResolutionPanelProps } from './ConflictResolutionPanel';

export { TerminalReadOnlyBanner } from './TerminalReadOnlyBanner';
export type { TerminalReadOnlyBannerProps } from './TerminalReadOnlyBanner';

export { TableEmptyState } from './TableEmptyState';
export type { TableEmptyStateProps } from './TableEmptyState';

export {
  ConfirmActionController,
  ConfirmActionDialog,
  confirmationCanSubmit,
} from './ConfirmActionDialog';
export type {
  ConfirmActionDialogProps,
  ConfirmActionLevel,
} from './ConfirmActionDialog';

export { TONES, type Tone } from './_tones';
