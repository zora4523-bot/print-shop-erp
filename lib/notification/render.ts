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
// - `{deepLink}` 的规范工单路径在 APP_PUBLIC_URL 有效时转成完整 URL；
//   payload 本身保持相对路径，未配置时保持原值。
// - 其余占位符值一律当纯文本：Markdown 元字符换成全角同形字符，控制字符
//   （含 CR/LF）折叠成一个空格。customerRef 等字段由外部销售填写，原样拼进
//   企业微信 Markdown 会注入可点击链接或伪造的消息行。只有系统生成的
//   deepLink 豁免（它本来就要作为链接）。全角替换不依赖接收端是否支持
//   反斜杠转义。
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
    if (key === 'deepLink' && typeof value === 'string') {
      return resolveNotificationDeepLink(value);
    }
    // String() 包装：兼容 number / boolean / Decimal-string / Date.toString
    // 避免 "[object Object]" 出现：调用方负责把对象/数组在 payload 里
    // 拍平成 string（events.ts 类型已约束）。
    return toInertMarkdownText(String(value));
  });
}

const CONTROL_CHAR_RUN_RE = /[\u0000-\u001F\u007F\u0085\u2028\u2029]+/g;
const MARKDOWN_META_RE = /[[\]()*_`<>#~\\]/g;
const FULL_WIDTH_MARKDOWN_META: Readonly<Record<string, string>> = {
  '[': '［',
  ']': '］',
  '(': '（',
  ')': '）',
  '*': '＊',
  _: '＿',
  '`': '｀',
  '<': '＜',
  '>': '＞',
  '#': '＃',
  '~': '～',
  '\\': '＼',
};

function toInertMarkdownText(value: string): string {
  return value
    .replace(CONTROL_CHAR_RUN_RE, ' ')
    .replace(MARKDOWN_META_RE, (character) => FULL_WIDTH_MARKDOWN_META[character] ?? character);
}

function resolveNotificationDeepLink(value: string): string {
  const prefix = '/orders#wo=';
  if (!value.startsWith(prefix) || value.length === prefix.length) return value;
  const configured = process.env.APP_PUBLIC_URL?.trim();
  if (!configured || /[\s\\]/.test(configured)) return value;

  try {
    const orderNo = value.slice(prefix.length);
    // The payload sanitizer owns this canonical path. Do not make arbitrary
    // payload URLs or malformed encodings clickable as a side effect.
    if (encodeURIComponent(decodeURIComponent(orderNo)) !== orderNo) return value;
    const base = new URL(configured);
    if (
      !['https:', 'http:'].includes(base.protocol) ||
      base.username ||
      base.password ||
      base.pathname !== '/' ||
      base.search ||
      base.hash
    ) {
      return value;
    }
    // Workers have no request headers. Using derivePublicBaseUrl() here would
    // invent localhost:3000 when configuration is absent, so only use the
    // explicit public origin. Keep this as a URL for custom Markdown templates.
    return `${base.origin}${value}`.replace(/[()]/g, (character) =>
      character === '(' ? '%28' : '%29',
    );
  } catch {
    return value;
  }
}
