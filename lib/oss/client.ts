import OSS from 'ali-oss';
import type { OssConfig } from './config';

// OSS 客户端构造 —— 全库统一出口（此前 4 处各自 new OSS，secure 判定
// 逻辑重复且容易漂移）。
//
// 两种凭证形态：
//   - 长期凭证（默认）：RAM 子账号 AK，服务端读写用（HEAD 校验、CDR
//     打包、预签只读 URL）。预签 URL 寿命跟随长期凭证，可签 24h。
//   - STS 临时凭证（传 sts）：AssumeRole 换出的短期凭证，浏览器直传
//     的预签 PUT URL 用它签（寿命 ≤ 凭证寿命）。
export function createOssClient(
  cfg: OssConfig,
  sts?: {
    accessKeyId: string;
    accessKeySecret: string;
    securityToken: string;
  },
): OSS {
  return new OSS({
    accessKeyId: sts?.accessKeyId ?? cfg.accessKeyId,
    accessKeySecret: sts?.accessKeySecret ?? cfg.accessKeySecret,
    ...(sts ? { stsToken: sts.securityToken } : {}),
    bucket: cfg.bucket,
    endpoint: cfg.endpoint,
    secure: cfg.endpoint.startsWith('https://'),
  });
}
