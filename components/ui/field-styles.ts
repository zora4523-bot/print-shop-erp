/**
 * Input / Textarea / NativeSelect 共用的一套控件规格（ui-规范 §2.4 圆角 rounded-md）：
 * 同一水平内距、焦点圈、aria-invalid 错误态、暗色底。只读态弱化底色与文字并改虚线边，
 * 明暗两套都能一眼区分「能改」与「只能看」。
 */
export const FIELD_BASE_CLASS =
  "w-full min-w-0 rounded-md border border-input bg-transparent px-3 text-base text-foreground transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40";

/**
 * 只认显式 readonly 属性：`:read-only` 伪类还会命中 type=file、disabled 等本可交互或
 * 另有禁用样式的控件（Codex 2026-09-29 指出上传入口被误显示为只读）。select 没有
 * readonly 属性，NativeSelect 改用 aria-readonly。
 */
export const FIELD_READONLY_CLASS =
  "[&[readonly]]:border-dashed [&[readonly]]:bg-muted [&[readonly]]:text-muted-foreground dark:[&[readonly]]:bg-muted";

export const FIELD_ARIA_READONLY_CLASS =
  "aria-readonly:pointer-events-none aria-readonly:border-dashed aria-readonly:bg-muted aria-readonly:text-muted-foreground dark:aria-readonly:bg-muted";
