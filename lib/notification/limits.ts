/** Enterprise WeCom group-bot limit for one markdown message. */
export const WECOM_MARKDOWN_MAX_BYTES = 4096;

const UTF8_ENCODER = new TextEncoder();

export function wecomMarkdownByteLength(content: string): number {
  return UTF8_ENCODER.encode(content).byteLength;
}

export function isWecomMarkdownWithinLimit(content: string): boolean {
  return wecomMarkdownByteLength(content) <= WECOM_MARKDOWN_MAX_BYTES;
}
