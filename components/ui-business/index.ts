// 业务原子组件 barrel export——业务页面统一从 '@/components/ui-business'
// 引入，不要单独 deep-import 文件路径，方便未来重构。

export { StatCard } from './StatCard';
export type { StatCardProps, StatDelta } from './StatCard';

export {
  StatusBadge,
  ORDER_STATUS_TO_BADGE,
  BILL_STATUS_TO_BADGE,
} from './StatusBadge';
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
export type { EmptyStateProps } from './EmptyState';

export { TableScrollArea } from './TableScrollArea';
export type { TableScrollAreaProps } from './TableScrollArea';

export { TONES, type Tone } from './_tones';
