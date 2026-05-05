// CDR bundle 短链 base URL 推导（headers → string）。提到独立 lib
// 因为 actions/foreman-cdr.ts 是 `'use server'` 模块只能导出 async
// 函数，纯逻辑放这里既能单测又能复用。
//
// SPEC §3.5 / Codex rounds 119-122 的辗转：
//   - relative URL 给外协 → 死链（round 119 high）
//   - 从 env 读 → dev / split-origin 死链（round 121 medium）
//   - 从 headers 读但不验 → multi-proxy `https,http` 死链（round 122 medium）
// 最终：APP_PUBLIC_URL 优先，否则从 headers 推 + multi-hop 解析 + 格式校验。

export function deriveBaseUrlFromHeaders(input: {
  proto: string | null | undefined;
  forwardedHost: string | null | undefined;
  host: string | null | undefined;
}): string {
  const proto = firstHopValue(input.proto);
  const host =
    firstHopValue(input.forwardedHost) ?? firstHopValue(input.host);
  if (
    proto &&
    host &&
    /^https?$/.test(proto) &&
    /^[\w.-]+(:\d+)?$/.test(host)
  ) {
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
