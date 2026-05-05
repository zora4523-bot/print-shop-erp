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
// 严格 round-trip（Codex round 125）：URL parser 接受很多输入但会
// 静默 canonicalize（`%65rp.example.com` → `erp.example.com`、
// `127.1` → `127.0.0.1`、`example.com:000443` → `example.com:443`、
// 缺省端口剥离）。link 是给外协看的，"接受但改写" 会让 foreman
// 复制时看到和 reverse-proxy 输入不一致的域，潜在伪装风险。
// 因此只接受 lowercase(input) === url.host 的 round-trip——除
// IPv6 字面量（方括号包）外允许 URL 自身的 zero-fold / IPv4-mapped
// 折叠这两类已知合法 canonicalization。

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
  // 边界字符 + percent-encoding（URL parser 会解码 `%65` → `e`，
  // 让 foreman 看到的链接域和 header 输入不同）。
  if (/[\s/?#@\\%]/.test(host)) return FALLBACK;
  let url: URL;
  try {
    url = new URL(`${proto}://${host}/`);
  } catch {
    return FALLBACK;
  }
  // 严格 round-trip 校验：URL parser 接受的输入若被静默 canonicalize
  // （IPv4 短格式 `127.1`、empty port `host:`、leading-zero `:000443`、
  // default-port 剥离 etc.），foreman 看到的链接域会和 header 不同。
  // 拒绝。IPv6 字面量（带方括号）例外——URL 对 IPv6 的 zero-fold /
  // IPv4-mapped 折叠是 WHATWG 标准里的合法 canonicalization，外协拿
  // 任一 URL parser 都解析回同一 host。
  const isBracketedIPv6 = host.startsWith('[');
  if (!isBracketedIPv6 && host.toLowerCase() !== url.host) {
    return FALLBACK;
  }
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
