// 业务原子组件共享的 tone 体系——封装语义色的&ldquo;icon 背景 + 前景&rdquo;
// 配对，让所有 KPI / 状态 / 快捷操作组件用同一套色板。
//
// 调整品牌色 / 加暗色模式 → 改 globals.css 的 --primary / --warning /
// --success / --info 即可，所有用到 tone 的组件自动跟着变。
//
// **不要在业务页面直接读这个 map**——业务页面只传 `tone="primary"` props，
// 由组件内部消费 map。这样组件的&ldquo;视觉判断&rdquo;封装得住。

export const TONES = [
  'primary',
  'warning',
  'info',
  'success',
  'neutral',
] as const;

export type Tone = (typeof TONES)[number];

// icon 容器：圆角方块（StatCard / ActionShortcut / NavCard 共用）。
// 用 alpha-mix（`bg-primary/10`）做 soft 背景而不是 -50 调色板，
// 避免和品牌色脱钩。
export const TONE_ICON_BOX: Record<Tone, string> = {
  primary: 'bg-primary/10 text-primary',
  warning: 'bg-warning/10 text-warning',
  info: 'bg-info/10 text-info',
  success: 'bg-success/10 text-success',
  neutral: 'bg-muted text-muted-foreground',
};

// 实色徽章：StatusBadge / Tag 类直接展示&ldquo;状态色&rdquo;时用。背景 + 同色暗版前景。
export const TONE_BADGE_SOFT: Record<Tone, string> = {
  primary: 'bg-primary/10 text-primary border-primary/20',
  warning: 'bg-warning/10 text-warning-foreground border-warning/30',
  info: 'bg-info/10 text-info-foreground border-info/30',
  success: 'bg-success/10 text-success-foreground border-success/30',
  neutral: 'bg-muted text-foreground border-border',
};

// 文本前景（无背景，纯文字色）：状态文字 / 趋势上下行箭头共用。
export const TONE_TEXT: Record<Tone, string> = {
  primary: 'text-primary',
  warning: 'text-warning',
  info: 'text-info',
  success: 'text-success',
  neutral: 'text-muted-foreground',
};
