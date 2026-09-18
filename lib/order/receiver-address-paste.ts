import type { ClipboardEvent } from 'react';
import { ZTO_PROVINCE_OPTIONS } from '../price/external-order-charges';

/**
 * Pasted receiver strings ("张三，138…，浙江省杭州市…[平台码]") are parsed once,
 * here, for every form that collects a delivery address. UI components only
 * render; they never re-implement the split.
 */
export type PastedReceiverFacts = {
  receiverName: string | null;
  receiverPhone: string | null;
  province: string | null;
};

export type ReceiverAddressDisplay = {
  address: string;
  platformCode: string | null;
  receiverName: string | null;
  receiverPhone: string | null;
};

export type ParsedReceiverAddress = PastedReceiverFacts &
  Pick<ReceiverAddressDisplay, 'address' | 'platformCode'>;

export function parsePastedReceiverAddress(value: string): PastedReceiverFacts {
  const normalized = value
    .trim()
    .replace(/[\r\n\t,，|]+/g, ' ')
    .replace(/\s+/g, ' ');
  const phoneMatch = normalized.match(
    /(?<!\d)(1[3-9](?:[-\s]?\d){9}|0\d{2,3}[-\s]?\d{7,8})(?!\d)/,
  );
  const receiverPhone = phoneMatch?.[1]?.replace(/\s/g, '') ?? null;
  const province =
    ZTO_PROVINCE_OPTIONS.find((candidate) =>
      new RegExp(`${candidate}(?:省|市|壮族自治区|回族自治区|维吾尔自治区|自治区)?`).test(
        normalized,
      ),
    ) ?? null;
  const explicitName = normalized.match(
    /(?:收货人|联系人|姓名)\s*[:：]?\s*([\p{Script=Han}A-Za-z·]{2,32}?)(?=\s|1[3-9]|0\d{2,3}|$)/u,
  )?.[1];
  const nameCandidates = normalized
    .replace(phoneMatch?.[0] ?? '', ' ')
    .replace(/(?:收货人|联系人|姓名|电话|手机|地址)\s*[:：]?/g, ' ')
    .split(/\s+/)
    .map((candidate) => candidate.trim())
    .filter(
      (candidate) =>
        /^[\p{Script=Han}A-Za-z·]{2,32}$/u.test(candidate) &&
        !/[省市区县旗镇乡街道路巷号弄栋座单元室村组社区花园大厦]/u.test(candidate) &&
        !ZTO_PROVINCE_OPTIONS.includes(candidate),
    );
  const receiverName = (explicitName ?? nameCandidates[0] ?? null)?.slice(
    0,
    64,
  ) ?? null;
  return { receiverName, receiverPhone, province };
}

export function parseExternalReceiverDisplay(raw: string): ReceiverAddressDisplay {
  const text = raw.trim();
  if (!text) {
    return {
      address: '',
      platformCode: null,
      receiverName: null,
      receiverPhone: null,
    };
  }
  const phone =
    text.match(/1[3-9]\d{9}/)?.[0] ??
    text.match(/\d{3,4}-\d{7,8}/)?.[0] ??
    '';
  const platformCode =
    text.match(/\[[0-9A-Za-z-]{2,}\]|[@#][0-9A-Za-z-]{4,}#?/)?.[0] ??
    null;
  const withoutPhone = text.replace(phone, ' ');
  const parts = withoutPhone
    .split(/[,，;；\n\t]|\s{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
  const hasSeparator = /[,，;；\n\t]|\s{2,}/.test(withoutPhone);
  let inferredName = phone || hasSeparator ? (parts[0] ?? '') : '';
  inferredName = inferredName
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[@#].*$/, '')
    .replace(/^(?:收货人|联系人|姓名)\s*[:：]?\s*/, '')
    .trim();
  if (
    inferredName.length > 10 ||
    /[省市区县旗镇乡街道路号栋楼层]/.test(inferredName)
  ) {
    inferredName = '';
  }
  const address = parts
    .slice(inferredName ? 1 : 0)
    .join(' ')
    .replace(platformCode ?? '', ' ')
    .replace(/^(?:地址)\s*[:：]?\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return {
    address,
    platformCode,
    receiverName: inferredName || null,
    receiverPhone: phone || null,
  };
}

/** Contact facts plus a display address; the shared paste field hands this to its parent. */
export function parseReceiverAddressInput(value: string): ParsedReceiverAddress {
  const facts = parsePastedReceiverAddress(value);
  const display = parseExternalReceiverDisplay(value);
  return {
    receiverName: facts.receiverName ?? display.receiverName,
    receiverPhone: facts.receiverPhone ?? display.receiverPhone,
    province: facts.province,
    address: display.address,
    platformCode: display.platformCode,
  };
}

export type ReceiverFactSource = 'input' | 'paste';

/**
 * One rule for every address form: a paste replaces the fact it produced,
 * typing only fills a blank. Keeps a chosen province (北京) from being
 * overwritten by a street name that mentions another one (广东大厦).
 */
export function applyParsedReceiverFact(
  current: string | null | undefined,
  candidate: string | null | undefined,
  source: ReceiverFactSource,
): string {
  const existing = current ?? '';
  if (!candidate) return existing;
  return source === 'paste' || !existing.trim() ? candidate : existing;
}

/** Detail line for structured party addresses: drop the province the paste already produced. */
export function stripProvincePrefix(address: string, province: string | null): string {
  if (!province) return address.trim();
  return address
    .replace(new RegExp(`^${province}(?:省|市|壮族自治区|回族自治区|维吾尔自治区|自治区)?`), '')
    .trim();
}

/** The textarea value as it would read after the paste lands at the caret. */
export function pastedTextareaValue(event: ClipboardEvent<HTMLTextAreaElement>): string {
  const pasted = event.clipboardData.getData('text');
  const textarea = event.currentTarget;
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? start;
  return `${textarea.value.slice(0, start)}${pasted}${textarea.value.slice(end)}`;
}
