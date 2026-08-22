import { headers } from 'next/headers';
import { deriveBaseUrlFromHeaders } from './cdr/base-url';

// 公网 base URL 推导（CDR 下载链接 / 工单二维码 URL 共用）：
//   1. APP_PUBLIC_URL（业主显式配置的公网域；split-origin 部署必走这条）
//   2. x-forwarded-proto + (x-forwarded-host || host) → 从请求头推
//      （dev localhost / ngrok / 单域名 prod 反代默认走这条）
//   3. 兜底 http://localhost:3000（无 request scope：单测 / 脚本）
//
// 头部解析与格式校验的细节（multi-hop 列表、IPv6、round-trip 校验）
// 都在 lib/cdr/base-url.ts 的纯函数里。
export async function derivePublicBaseUrl(): Promise<string> {
  if (process.env.APP_PUBLIC_URL) {
    return process.env.APP_PUBLIC_URL.replace(/\/+$/, '');
  }
  try {
    const h = await headers();
    return deriveBaseUrlFromHeaders({
      proto: h.get('x-forwarded-proto'),
      forwardedHost: h.get('x-forwarded-host'),
      host: h.get('host'),
    });
  } catch {
    return 'http://localhost:3000';
  }
}
