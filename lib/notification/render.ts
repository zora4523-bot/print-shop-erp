// 模板渲染：替换 `{key}` 占位符。
//
// 设计选择 — 为什么不用 mustache / handlebars / es-template?
// (a) MVP 模板内容是中文文本 + 几个字段，不需要循环 / 条件 / partial
// (b) 模板字符串存在 NotificationRule.messageTemplate (DB 列)，输入
//     是 owner UI 输入的，不能让模板引擎执行任意逻辑（注入风险）
// (c) 简单字符串替换 + 留缺失占位符 = 让 owner 一眼看出&ldquo;模板拼错了&rdquo;
//     ——比模板引擎抛错栈友好得多（owner 不看 stack trace）
//
// 行为契约：
// - `{key}` 处 payload 有 key 且不是 null/undefined → 替换为 String(value)
// - `{key}` 处 payload 没 key（或 null/undefined）→ 保留 `{key}` 原样
// - 同一 key 多次出现 → 全部替换
// - 嵌套 `{` `}` 不支持 —— 仅 ASCII letter / digit / underscore 的 key
//   匹配（`{foo_bar}` ✓，`{foo.bar}` ✗，`{foo-bar}` ✗）

const PLACEHOLDER_RE = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g;

export function renderTemplate(
  template: string,
  payload: Readonly<Record<string, unknown>>,
): string {
  return template.replace(PLACEHOLDER_RE, (match, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) {
      // 缺失 key 留原样 —— 让 owner 看到模板有 placeholder 没填
      return match;
    }
    const value = payload[key];
    if (value === null || value === undefined) {
      return match;
    }
    // String() 包装：兼容 number / boolean / Decimal-string / Date.toString
    // 避免 "[object Object]" 出现：调用方负责把对象/数组在 payload 里
    // 拍平成 string（events.ts 类型已约束）。
    return String(value);
  });
}
