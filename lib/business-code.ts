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
  if (!customCode) return nextBusinessCode(kind);

  const serial = generatedCodeSerial(kind, customCode);
  if (serial !== null) {
    // A custom code may intentionally use the public automatic-code format.
    // Advance the counter before the entity insert so future automatic codes
    // never walk backwards into an already occupied value. Gaps are acceptable
    // for human-readable identifiers; duplicate identifiers are not.
    await db.$executeRaw`
      INSERT INTO "BusinessCodeSequence" ("key", "value", "updatedAt")
      VALUES (${kind}, ${serial}, NOW())
      ON CONFLICT ("key") DO UPDATE
         SET "value" = GREATEST("BusinessCodeSequence"."value", EXCLUDED."value"),
             "updatedAt" = NOW()
    `;
  }

  return customCode;
}

function generatedCodeSerial(
  kind: BusinessCodeKind,
  code: string,
): number | null {
  const spec = CODE_SPECS[kind];
  const pattern = new RegExp(
    `^${spec.prefix}${spec.separator}(\\d{${spec.width}})$`,
    'i',
  );
  const match = pattern.exec(code);
  if (!match) return null;
  const serial = Number.parseInt(match[1]!, 10);
  return Number.isSafeInteger(serial) ? serial : null;
}
