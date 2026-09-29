/**
 * 必填标记的唯一写法（ui 审查 #49）：红色加粗星号，紧跟标签文字，读屏忽略——
 * 必填语义由控件自身的 `required` / `aria-required` 表达。
 *
 * 星号用 CSS 生成内容（`after:content-['*']`）而不是文本节点：`aria-hidden` 只把它移出
 * 无障碍名称，文本节点仍会进 `<label>` 的 textContent，让按标签文字定位控件的调用方
 * （Playwright `getByLabel`、`label.textContent`）拿到「字段名*」。生成内容两边都不进。
 */
export function RequiredMark() {
  return (
    <span
      aria-hidden="true"
      data-slot="required-mark"
      className="ml-0.5 font-bold text-destructive after:content-['*']"
    />
  );
}
