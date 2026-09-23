import type { OssConfig } from './config';

// 从登记时存下的 fileUrl（`${publicBaseUrl}/${objectKey}`）反推 OSS 对象 key。
// 设计图预览签名（read-url.ts）与 CDR 打包（cdr/zip.ts）共用。
//
// 只认本 bucket 的两个读取域（publicBaseUrl / bucketUrl），按 host 匹配；
// OSS_PUBLIC_BASE_URL 可以带路径（如 https://cdn.example.com/assets），
// 存下的 fileUrl 是 /assets/design/...，要剥掉匹配到的读取域的路径前缀
// 才是真 key。没有读取域匹配时返回 null，是否兜底由调用方决定。
// 不校验 design/ 前缀（调用方各自处理）。
export function objectKeyFromReadUrl(
  url: URL,
  cfg: Pick<OssConfig, 'publicBaseUrl' | 'bucketUrl'>,
): string | null {
  for (const base of [cfg.publicBaseUrl, cfg.bucketUrl]) {
    let baseUrl: URL;
    try {
      baseUrl = new URL(base);
    } catch {
      continue; // config 派生值不合法时跳过
    }
    if (url.host !== baseUrl.host) continue;
    const basePath = baseUrl.pathname.replace(/\/+$/, '');
    const fullPath = decodeURIComponent(url.pathname);
    if (basePath && !fullPath.startsWith(`${basePath}/`)) continue;
    return fullPath.slice(basePath.length).replace(/^\/+/, '');
  }
  return null;
}
