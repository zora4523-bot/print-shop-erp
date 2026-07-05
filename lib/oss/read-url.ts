import OSS from 'ali-oss';
import { readOssConfig } from './config';

// 设计图只读 URL 签发（服务端渲染时用）。
//
// bucket 是私有的：OrderItemDesign.fileUrl 存的是不带签名的
// `${publicBaseUrl}/${objectKey}`，浏览器 <img> 直接 GET 会 403。
// 详情页/打印视图渲染前把它换成短期预签 GET URL（30 分钟——够一次
// 页面停留 + Puppeteer PDF 渲染；过期刷新页面即重签）。
//
// 不签直接原样返回的情况（调用方无需分支）：
//   - OSS 未配置 / 配置解析失败（dev 裸跑，本来就渲染不出图）
//   - fileUrl 不是合法 URL、或对象不在本 bucket 的 design/ 前缀下
//     （mock 数据、历史脏数据、将来接 CDN 公网域名时的直读 URL）

const READ_URL_EXPIRES_SECONDS = 30 * 60;

export function signDesignReadUrl(
  fileUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  let cfgResult: ReturnType<typeof readOssConfig>;
  try {
    cfgResult = readOssConfig(env);
  } catch {
    return fileUrl;
  }
  if (!cfgResult.configured) return fileUrl;
  const cfg = cfgResult.cfg;

  let url: URL;
  try {
    url = new URL(fileUrl);
  } catch {
    return fileUrl;
  }
  // 只处理指向本 bucket 读取域（publicBaseUrl / bucketUrl）的 URL——
  // 其他 host 一律原样放行，避免把外部链接误签成本 bucket 的 key。
  const knownHosts = new Set<string>();
  for (const base of [cfg.publicBaseUrl, cfg.bucketUrl]) {
    try {
      knownHosts.add(new URL(base).host);
    } catch {
      /* config 派生值不合法时跳过 */
    }
  }
  if (!knownHosts.has(url.host)) return fileUrl;

  const objectKey = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  if (!objectKey.startsWith('design/')) return fileUrl;

  const client = new OSS({
    accessKeyId: cfg.accessKeyId,
    accessKeySecret: cfg.accessKeySecret,
    bucket: cfg.bucket,
    endpoint: cfg.endpoint,
    secure: cfg.endpoint.startsWith('https://'),
  });
  return client.signatureUrl(objectKey, {
    expires: READ_URL_EXPIRES_SECONDS,
    method: 'GET',
  });
}
