import { readOssConfig } from './config';
import { createOssClient } from './client';
import { objectKeyFromReadUrl } from './object-key';

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

// 过期时间按固定 30 分钟桶取整（审查 #4）：同一对象在一个桶内签出的 URL
// 完全相同，浏览器缓存可以跨页面切换复用缩略图，不再每次 RSC 刷新都换 URL
// 重新下载。取整目标 = 「now + 有效期下限」向上取到桶边界，所以剩余有效期
// 落在 [READ_URL_EXPIRES_SECONDS / 2, READ_URL_EXPIRES_SECONDS / 2 + 桶长)。
export const READ_URL_BUCKET_SECONDS = 30 * 60;
export const READ_URL_MIN_REMAINING_SECONDS = READ_URL_EXPIRES_SECONDS / 2;

// 列表缩略图走 OSS 图片处理缩放版；x-oss-process 作为子资源进入签名
// （ali-oss signatureUrl 的 options.process）。
export const DESIGN_THUMBNAIL_PROCESS = 'image/resize,m_lfit,w_160,h_160';
// 师傅端设计图网格：手机两列约 170 CSS px，2–3 倍屏需要 ~480 px。原图可达 10 MiB，
// 网格里直接用原图一页六张约 25 MB（实测 4× 降速 CPU 解码 810 ms，480 px 版 30 ms）。
export const DESIGN_GALLERY_PROCESS = 'image/resize,m_lfit,w_480,h_480';

export function designReadUrlExpiresAt(nowSeconds: number): number {
  const floor = nowSeconds + READ_URL_MIN_REMAINING_SECONDS;
  return Math.ceil(floor / READ_URL_BUCKET_SECONDS) * READ_URL_BUCKET_SECONDS;
}

export function signDesignReadUrl(
  fileUrl: string,
  env: NodeJS.ProcessEnv = process.env,
  options: { thumbnail?: boolean; gallery?: boolean } = {},
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
  const objectKey = objectKeyFromReadUrl(url, cfg);
  if (!objectKey || !objectKey.startsWith('design/')) return fileUrl;

  const client = createOssClient(cfg);
  // ali-oss 的 expires 是相对秒数（内部 = 当前秒 + expires），这里换算成
  // 桶边界的相对值；两次读秒同一秒内完成，跨秒的极小窗口只会让该次 URL
  // 与桶内其它 URL 不同，不影响正确性。
  const nowSeconds = Math.floor(Date.now() / 1000);
  return client.signatureUrl(objectKey, {
    expires: designReadUrlExpiresAt(nowSeconds) - nowSeconds,
    method: 'GET',
    ...(options.thumbnail
      ? { process: DESIGN_THUMBNAIL_PROCESS }
      : options.gallery
        ? { process: DESIGN_GALLERY_PROCESS }
        : {}),
  });
}
