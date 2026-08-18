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
  'danger',
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
  danger: 'bg-destructive/10 text-destructive',
  neutral: 'bg-muted text-muted-foreground',
};

// 实色徽章：StatusBadge / Tag 类直接展示&ldquo;状态色&rdquo;时用。背景 + 同色暗版前景。
export const TONE_BADGE_SOFT: Record<Tone, string> = {
  primary: 'bg-primary/10 text-primary border-primary/20',
  warning: 'bg-warning/10 text-warning-foreground border-warning/30',
  info: 'bg-info/10 text-info-foreground border-info/30',
  success: 'bg-success/10 text-success-foreground border-success/30',
  // 「已取消 / 失败」这类**非正常终态**专用。之前只能退回 neutral，
  // 结果和「草稿」「已完成」同色，用户分不出正常结束和被取消。
  danger: 'bg-destructive/10 text-destructive border-destructive/30',
  neutral: 'bg-muted text-foreground border-border',
};

// 实心圆点：StatusBadge 的“进行中”指示点。之前是组件里一串五层三元，
// 加第六个 tone 时必然漏改，抽成 map 让 Record<Tone,…> 强制穷尽。
export const TONE_DOT: Record<Tone, string> = {
  primary: 'bg-primary',
  warning: 'bg-warning',
  info: 'bg-info',
  success: 'bg-success',
  danger: 'bg-destructive',
  neutral: 'bg-muted-foreground',
};

// 文本前景（无背景，纯文字色）：状态文字 / 趋势上下行箭头共用。
export const TONE_TEXT: Record<Tone, string> = {
  primary: 'text-primary',
  warning: 'text-warning',
  info: 'text-info',
  success: 'text-success',
  danger: 'text-destructive',
  neutral: 'text-muted-foreground',
};
