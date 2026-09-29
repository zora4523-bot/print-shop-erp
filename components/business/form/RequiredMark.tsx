/**
 * 必填标记的唯一写法（ui 审查 #49）：红色加粗星号，紧跟标签文字，读屏忽略——
 * 必填语义由控件自身的 `required` / `aria-required` 表达。
 */
export function RequiredMark() {
  return (
    <span aria-hidden="true" className="ml-0.5 font-bold text-destructive">
      *
    </span>
  );
}
