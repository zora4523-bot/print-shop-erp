import { readOssConfig } from './config';
import { createOssClient } from './client';

// 设计图只读 URL 签发（服务端渲染时用）。
//
// bucket 是私有的：OrderItemDesign.fileUrl 存的是不带签名的
// `${publicBaseUrl}/${objectKey}`，浏览器 <img> 直接 GET 会 403。
// 详情页/打印视图渲染前把它换成短期预签 GET URL（30 分钟——够一次
// 页面停留 + Puppeteer PDF 渲染；过期刷新页面即重签）。
//
// 不签直接原样返回的情况（调用方无需分支）：
//   - OSS 未配置 / 配置解析失败（dev 裸跑，本来就渲染不出图）
//   - fileUrl 不是合法 URL、host 不属于本 bucket 的读取域、或对象
//     不在 design/ 前缀下（mock 数据、历史脏数据、外部链接）
//
// OSS_PUBLIC_BASE_URL 配了 CDN/自定义域名时：本函数仍返回**签名的
// bucket 直连 URL**（绕开 CDN）——私有 bucket 下 CDN 直读需要 CDN
// 侧 URL 鉴权 + 私有回源配置，属部署项；等真的接 CDN 时再做 CDN
// 签名（P1）。绕开 CDN 只损失缓存加速，不损失正确性。
//
// **只给 IMAGE 用**。CDR 源文件在详情页/打印视图都不渲染、不提供
// 链接——给无 design:bundle 权限的角色发放可用的 CDR 下载 URL 是
// 越权（SPEC §2.2）。CDR 的受控下载口只有 /api/cdr/bundles/<access-token>。

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
  // objectKey 相对匹配到的 base 的路径前缀取（OSS_PUBLIC_BASE_URL
  // 可以带路径，如 https://cdn.example.com/assets——存的 fileUrl 是
  // /assets/design/...，剥掉 /assets 才是真 key）。
  let objectKey: string | null = null;
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
    objectKey = fullPath.slice(basePath.length).replace(/^\/+/, '');
    break;
  }
  if (!objectKey || !objectKey.startsWith('design/')) return fileUrl;

  const client = createOssClient(cfg);
  return client.signatureUrl(objectKey, {
    expires: READ_URL_EXPIRES_SECONDS,
    method: 'GET',
  });
}
