import { ALLOWED_EXTENSIONS, type DesignFileType } from './types';

// 设计文件名（OrderItemDesign.fileName）的统一规则：签发上传凭证、登记落库
// 两处共用，CDR 汇总下载包再把它当作 ZIP 条目名发给外协解压。所以它必须是
// 单段文件名：
//   - 不含路径分隔符（/ 或 \）——`..` 只有作为路径段才危险，拒绝分隔符后
//     它无法构成路径段；
//   - 不含控制字符（C0 / DEL / C1）；
//   - 不含双向覆盖/隔离字符（U+202A–U+202E、U+2066–U+2069），它们能把
//     `invoice<RLO>exe.cdr` 显示成 `invoicerdc.exe`；
//   - 扩展名属于该 fileType 允许的扩展名（与签发时一致）。
const PATH_SEPARATOR_RE = /[/\\]/;
const UNSAFE_CHARS_RE = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/;
const UNSAFE_CHARS_GLOBAL_RE = new RegExp(UNSAFE_CHARS_RE.source, 'g');

export function extractFileExtension(fileName: string): string | null {
  const idx = fileName.lastIndexOf('.');
  if (idx < 0 || idx === fileName.length - 1) return null;
  return fileName.slice(idx + 1).toLowerCase();
}

// 返回第一条不合规原因（直接给用户看的文案）；合规返回 null。
export function designFileNameIssue(
  fileName: string,
  fileType: DesignFileType,
): string | null {
  if (fileName.trim() === '') return '文件名不能为空';
  if (PATH_SEPARATOR_RE.test(fileName)) {
    return '文件名不能包含“/”或“\\”，请改名后再上传';
  }
  if (UNSAFE_CHARS_RE.test(fileName)) {
    return '文件名含有无法显示的特殊字符，请改名后再上传';
  }
  const ext = extractFileExtension(fileName);
  const allowedExts = ALLOWED_EXTENSIONS[fileType];
  if (!ext || !allowedExts.includes(ext)) {
    return `文件扩展名与类型不匹配（${fileType} 期望：${allowedExts.join(', ')}）`;
  }
  return null;
}

// 去掉控制字符与双向覆盖/隔离字符（给已落库的历史文件名做防御性清洗）。
export function stripUnsafeFileNameChars(fileName: string): string {
  return fileName.replace(UNSAFE_CHARS_GLOBAL_RE, '');
}
