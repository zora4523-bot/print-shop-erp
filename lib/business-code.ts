import { db } from './db';

export type BusinessCodeKind =
  | 'PRODUCT'
  | 'CRAFT'
  | 'PARTY'
  | 'MATERIAL'
  | 'WAREHOUSE'
  | 'LOCATION';

type CodeSpec = {
  prefix: string;
  separator: '-' | '_';
  width: number;
};

const CODE_SPECS: Record<BusinessCodeKind, CodeSpec> = {
  PRODUCT: { prefix: 'PRD', separator: '-', width: 6 },
  CRAFT: { prefix: 'CRF', separator: '_', width: 6 },
  PARTY: { prefix: 'PTY', separator: '-', width: 6 },
  MATERIAL: { prefix: 'MAT', separator: '-', width: 6 },
  WAREHOUSE: { prefix: 'WH', separator: '-', width: 6 },
  LOCATION: { prefix: 'LOC', separator: '-', width: 6 },
};

export class BusinessCodeExhaustedError extends Error {
  constructor(kind: BusinessCodeKind) {
    super(`${kind} 自动编码序列已超出可用范围`);
    this.name = 'BusinessCodeExhaustedError';
  }
}

export async function nextBusinessCode(kind: BusinessCodeKind): Promise<string> {
  const spec = CODE_SPECS[kind];
  const sequence = await db.businessCodeSequence.upsert({
    where: { key: kind },
    create: { key: kind, value: 1 },
    update: { value: { increment: 1 } },
    select: { value: true },
  });

  const serial = String(sequence.value);
  if (serial.length > spec.width) throw new BusinessCodeExhaustedError(kind);

  return `${spec.prefix}${spec.separator}${serial.padStart(spec.width, '0')}`;
}

export async function resolveBusinessCode(
  kind: BusinessCodeKind,
  requestedCode: string | null | undefined,
): Promise<string> {
  const customCode = requestedCode?.trim();
  return customCode || nextBusinessCode(kind);
}
