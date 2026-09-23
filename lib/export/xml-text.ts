// XLSX 工作表 XML 的文本转义：两个写入器（xlsx.ts 流式导出、xlsx-cell.ts
// 计件导出）共用。XML 1.0 的 Char 产生式不允许 #x0-#x8、#xB、#xC、
// #xE-#x1F、#xFFFE、#xFFFF——写成字符引用也不行，只能删除；制表符、
// 换行、回车合法，保留。
export function stripInvalidXmlCharacters(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '');
}

export function escapeXmlText(value: string): string {
  return stripInvalidXmlCharacters(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
