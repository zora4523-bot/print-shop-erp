// CDR bundle 短链 base URL 推导（headers → string）。提到独立 lib
// 因为 actions/foreman-cdr.ts 是 `'use server'` 模块只能导出 async
// 函数，纯逻辑放这里既能单测又能复用。
//
// SPEC §3.5 / Codex rounds 119-122 的辗转：
//   - relative URL 给外协 → 死链（round 119 high）
//   - 从 env 读 → dev / split-origin 死链（round 121 medium）
//   - 从 headers 读但不验 → multi-proxy `https,http` 死链（round 122 medium）
// 最终：APP_PUBLIC_URL 优先，否则从 headers 推 + multi-hop 解析 + 格式校验。

// host 接受三种合法形态：
//   - DNS-style：`erp.example.com` / `erp.example.com:8443`
//   - IPv4-style：`192.168.1.1` / `192.168.1.1:3000`（也匹配 DNS 正则）
//   - IPv6-style：`[::1]` / `[2001:db8::1]:8443`（必须带方括号——
//     URL 标准要求 IPv6 字面量在 `://` 后用方括号包；裸 `::1` 在
//     URL 里会和 port 分隔符 `:` 撞）
// 拒绝包含空格 / 单引号 / 等任何注入字符的输入。
const HOST_RE = /^(?:[\w.-]+|\[[0-9a-fA-F:]+\])(:\d+)?$/;

export function deriveBaseUrlFromHeaders(input: {
  proto: string | null | undefined;
  forwardedHost: string | null | undefined;
  host: string | null | undefined;
}): string {
  const proto = firstHopValue(input.proto);
  const host =
    firstHopValue(input.forwardedHost) ?? firstHopValue(input.host);
  if (proto && host && /^https?$/.test(proto) && HOST_RE.test(host)) {
    return `${proto}://${host}`;
  }
  // proto 缺失 / 格式不合法 → fallback localhost；不默认 http 给错的
  // 降级链。
  return 'http://localhost:3000';
}

// x-forwarded-* 多 proxy hop 时是 `value1, value2` —— 取第一个原始
// 值（最靠近客户端那跳）。
function firstHopValue(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const first = raw.split(',')[0]?.trim();
  return first && first.length > 0 ? first : null;
}
