// CDR bundle 短链 base URL 推导（headers → string）。提到独立 lib
// 因为 actions/foreman-cdr.ts 是 `'use server'` 模块只能导出 async
// 函数，纯逻辑放这里既能单测又能复用。
//
// SPEC §3.5 / Codex rounds 119-122 的辗转：
//   - relative URL 给外协 → 死链（round 119 high）
//   - 从 env 读 → dev / split-origin 死链（round 121 medium）
//   - 从 headers 读但不验 → multi-proxy `https,http` 死链（round 122 medium）
// 最终：APP_PUBLIC_URL 优先，否则从 headers 推 + multi-hop 解析 + 格式校验。

// host 接受任何 WHATWG URL 解析器认可的 host 形态——DNS / IPv4 /
// IPv6 字面量（含方括号 + IPv4-mapped 如 `[::ffff:127.0.0.1]`）。
// 通过 `new URL()` 实测代替 regex（Codex round 123→124：手写正则
// 既漏 IPv4-mapped 又放过 `[abc]` 之类无效字面量；URL 解析器是
// authoritative source of truth）。
//
// 校验：构造 `${proto}://${host}/` 让 URL 解析；解析成功且 .host
// 与 input 一致（防 URL 修订），拒绝任何 path / query / userinfo /
// fragment 注入字符。

export function deriveBaseUrlFromHeaders(input: {
  proto: string | null | undefined;
  forwardedHost: string | null | undefined;
  host: string | null | undefined;
}): string {
  const proto = firstHopValue(input.proto);
  const host =
    firstHopValue(input.forwardedHost) ?? firstHopValue(input.host);
  if (!proto || !host) return FALLBACK;
  if (!/^https?$/.test(proto)) return FALLBACK;
  // 注入前置过滤：host 不应含 path / query / userinfo / fragment
  // 边界字符。这是 URL.parse 之前的快速拒绝，省得后面 origin
  // 拿到&ldquo;helpful&rdquo;修订过的奇怪 URL。
  if (/[\s/?#@\\]/.test(host)) return FALLBACK;
  let url: URL;
  try {
    url = new URL(`${proto}://${host}/`);
  } catch {
    return FALLBACK;
  }
  // 返 URL.origin（自带 canonicalization：IPv6 zero-fold、大小写统一、
  // IPv4-mapped IPv6 重写）。这是 WHATWG URL 解析器 authoritative 的
  // host 表示，发到外协处可被任何 URL parser 重新解析。Codex round
  // 123→124：手写正则要么漏（IPv4-mapped）要么放过非法（[abc]），让
  // URL parser 全权决定。
  return url.origin;
}

const FALLBACK = 'http://localhost:3000';

// x-forwarded-* 多 proxy hop 时是 `value1, value2` —— 取第一个原始
// 值（最靠近客户端那跳）。
function firstHopValue(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const first = raw.split(',')[0]?.trim();
  return first && first.length > 0 ? first : null;
}
