import {
  PartyType,
  Prisma,
  type Party,
  type PartyAddress,
  type PartyContact,
} from '../generated/prisma/client';
import {
  paginatedResult,
  paginationWindow,
  type PaginatedResult,
  type SortDirection,
} from './admin/table';
import { db } from './db';
import { writeAuditLogInTx, type AuditActor } from './audit-log';
import { resolveBusinessCode } from './business-code';
import { sortBySearchRelevance } from './search-ranking';
import type { CreatePartyInput, UpdatePartyInput } from './auth/schemas';

export class PartyInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PartyInvariantError';
  }
}

export const PARTY_TYPE_LABELS: Record<PartyType, string> = {
  CUSTOMER: '客户',
  SUPPLIER: '供应商',
  BOTH: '客户/供应商',
};

export type PartyContactSummary = Pick<
  PartyContact,
  'id' | 'name' | 'phone' | 'wechat' | 'isPrimary' | 'sortOrder'
>;

export type PartyAddressSummary = Pick<
  PartyAddress,
  | 'id'
  | 'receiverName'
  | 'receiverPhone'
  | 'province'
  | 'city'
  | 'district'
  | 'detail'
  | 'isDefault'
  | 'sortOrder'
>;

export type PartySummary = Pick<
  Party,
  | 'id'
  | 'type'
  | 'code'
  | 'name'
  | 'shortName'
  | 'searchPinyin'
  | 'searchPinyinInitials'
  | 'isActive'
  | 'createdAt'
  | 'updatedAt'
> & {
  primaryContact: PartyContactSummary | null;
  defaultAddress: PartyAddressSummary | null;
};

export type SupplierPartyOption = {
  id: string;
  code: string;
  name: string;
  shortName: string | null;
  contactName: string | null;
  contactPhone: string | null;
};

export const PARTY_LIST_SORT_KEYS = [
  'default',
  'code',
  'name',
  'type',
  'updatedAt',
] as const;

export type PartyListSortKey = (typeof PARTY_LIST_SORT_KEYS)[number];

const PARTY_SELECT = {
  id: true,
  type: true,
  code: true,
  name: true,
  shortName: true,
  searchPinyin: true,
  searchPinyinInitials: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  contacts: {
    where: { isPrimary: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    take: 1,
    select: {
      id: true,
      name: true,
      phone: true,
      wechat: true,
      isPrimary: true,
      sortOrder: true,
    },
  },
  addresses: {
    where: { isDefault: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    take: 1,
    select: {
      id: true,
      receiverName: true,
      receiverPhone: true,
      province: true,
      city: true,
      district: true,
      detail: true,
      isDefault: true,
      sortOrder: true,
    },
  },
} satisfies Prisma.PartySelect;

type PartyRow = Prisma.PartyGetPayload<{ select: typeof PARTY_SELECT }>;

function normalizeSearchQuery(q?: string | null): string | null {
  const trimmed = q?.trim();
  return trimmed ? trimmed.slice(0, 80) : null;
}

function compact<T>(items: Array<T | undefined>): T[] {
  return items.filter((item): item is T => item !== undefined);
}

function partySearchFilter(q?: string | null) {
  const query = normalizeSearchQuery(q);
  if (!query) return undefined;
  return {
    OR: [
      { code: { contains: query, mode: 'insensitive' as const } },
      { name: { contains: query, mode: 'insensitive' as const } },
      { shortName: { contains: query, mode: 'insensitive' as const } },
      { searchPinyin: { contains: query, mode: 'insensitive' as const } },
      { searchPinyinInitials: { contains: query, mode: 'insensitive' as const } },
      {
        contacts: {
          some: {
            OR: [
              { name: { contains: query, mode: 'insensitive' as const } },
              { phone: { contains: query, mode: 'insensitive' as const } },
              { wechat: { contains: query, mode: 'insensitive' as const } },
            ],
          },
        },
      },
      {
        addresses: {
          some: {
            OR: [
              { receiverName: { contains: query, mode: 'insensitive' as const } },
              { receiverPhone: { contains: query, mode: 'insensitive' as const } },
              { province: { contains: query, mode: 'insensitive' as const } },
              { city: { contains: query, mode: 'insensitive' as const } },
              { district: { contains: query, mode: 'insensitive' as const } },
              { detail: { contains: query, mode: 'insensitive' as const } },
            ],
          },
        },
      },
    ],
  };
}

function normalizePartyRow(row: PartyRow): PartySummary {
  const { contacts, addresses, ...party } = row;
  return {
    ...party,
    primaryContact: contacts[0] ?? null,
    defaultAddress: addresses[0] ?? null,
  };
}

function partyListOrderBy(
  sort: PartyListSortKey,
  direction: SortDirection,
): Prisma.PartyOrderByWithRelationInput[] {
  switch (sort) {
    case 'code':
      return [{ code: direction }, { id: 'asc' }];
    case 'name':
      return [{ name: direction }, { id: 'asc' }];
    case 'type':
      return [{ type: direction }, { name: 'asc' }, { id: 'asc' }];
    case 'updatedAt':
      return [{ updatedAt: direction }, { id: 'asc' }];
    default:
      return [
        { isActive: 'desc' },
        { type: 'asc' },
        { name: 'asc' },
        { id: 'asc' },
      ];
  }
}

export async function listParties(opts: {
  q?: string | null;
  type?: PartyType | null;
} = {}): Promise<PartySummary[]> {
  const query = normalizeSearchQuery(opts.q);
  const filters = compact([
    opts.type ? { type: opts.type } : undefined,
    partySearchFilter(query),
  ]);
  const rows = await db.party.findMany({
    where: filters.length ? { AND: filters } : undefined,
    select: PARTY_SELECT,
    orderBy: [{ isActive: 'desc' }, { type: 'asc' }, { name: 'asc' }],
  });
  const normalized = rows.map(normalizePartyRow);
  return sortBySearchRelevance(normalized, query, (row) => ({
    fields: [
      row.code,
      row.name,
      row.shortName,
      row.primaryContact?.name,
      row.primaryContact?.phone,
      row.primaryContact?.wechat,
      row.defaultAddress?.receiverName,
      row.defaultAddress?.receiverPhone,
      row.defaultAddress?.province,
      row.defaultAddress?.city,
      row.defaultAddress?.district,
      row.defaultAddress?.detail,
    ],
    pinyinFields: [row.searchPinyin, row.searchPinyinInitials],
  }));
}

export async function listPartiesPage(opts: {
  q?: string | null;
  type?: PartyType | null;
  page: number;
  pageSize: number;
  sort: PartyListSortKey;
  direction: SortDirection;
}): Promise<PaginatedResult<PartySummary>> {
  const query = normalizeSearchQuery(opts.q);
  const filters = compact([
    opts.type ? { type: opts.type } : undefined,
    partySearchFilter(query),
  ]);
  const where: Prisma.PartyWhereInput | undefined = filters.length
    ? { AND: filters }
    : undefined;
  const total = await db.party.count({ where });
  const window = paginationWindow(total, opts.page, opts.pageSize);
  const rows = await db.party.findMany({
    where,
    select: PARTY_SELECT,
    orderBy: partyListOrderBy(opts.sort, opts.direction),
    skip: window.skip,
    take: window.take,
  });
  return paginatedResult(rows.map(normalizePartyRow), total, window);
}

export async function getPartySummary(
  id: string,
): Promise<PartySummary | null> {
  const row = await db.party.findUnique({ where: { id }, select: PARTY_SELECT });
  return row ? normalizePartyRow(row) : null;
}

export async function listSupplierPartyOptions(): Promise<SupplierPartyOption[]> {
  const rows = await db.party.findMany({
    where: {
      isActive: true,
      OR: [{ type: PartyType.SUPPLIER }, { type: PartyType.BOTH }],
    },
    select: PARTY_SELECT,
    orderBy: [{ code: 'asc' }, { name: 'asc' }],
  });

  return rows.map((row) => {
    const party = normalizePartyRow(row);
    return {
      id: party.id,
      code: party.code,
      name: party.name,
      shortName: party.shortName,
      contactName: party.primaryContact?.name ?? null,
      contactPhone: party.primaryContact?.phone ?? null,
    };
  });
}

export type CreatePartyData = CreatePartyInput;
export type UpdatePartyData = UpdatePartyInput;

function supportsCustomer(type: PartyType): boolean {
  return type === PartyType.CUSTOMER || type === PartyType.BOTH;
}

function supportsSupplier(type: PartyType): boolean {
  return type === PartyType.SUPPLIER || type === PartyType.BOTH;
}

function hasContactData(data: CreatePartyData | UpdatePartyData): boolean {
  return Boolean(
    data.primaryContactName ||
      data.primaryContactPhone ||
      data.primaryContactWechat,
  );
}

function hasAddressData(data: CreatePartyData | UpdatePartyData): boolean {
  return Boolean(data.defaultAddressDetail);
}

function primaryContactData(data: CreatePartyData | UpdatePartyData) {
  if (!hasContactData(data)) return null;
  return {
    name: data.primaryContactName ?? data.name,
    phone: data.primaryContactPhone,
    wechat: data.primaryContactWechat,
    isPrimary: true,
    sortOrder: 0,
  };
}

function defaultAddressData(data: CreatePartyData | UpdatePartyData) {
  if (!hasAddressData(data)) return null;
  return {
    receiverName: data.defaultReceiverName,
    receiverPhone: data.defaultReceiverPhone,
    province: data.defaultProvince,
    city: data.defaultCity,
    district: data.defaultDistrict,
    detail: data.defaultAddressDetail as string,
    isDefault: true,
    sortOrder: 0,
  };
}

export async function createParty(data: CreatePartyData): Promise<PartySummary> {
  const code = await resolveBusinessCode('PARTY', data.code);
  const created = await db.$transaction(async (tx) => {
    const party = await tx.party.create({
      data: {
        type: data.type,
        code,
        name: data.name,
        shortName: data.shortName,
        isActive: true,
      },
      select: { id: true },
    });

    const contact = primaryContactData(data);
    if (contact) {
      await tx.partyContact.create({
        data: { ...contact, partyId: party.id },
      });
    }

    const address = defaultAddressData(data);
    if (address) {
      await tx.partyAddress.create({
        data: { ...address, partyId: party.id },
      });
    }

    return party;
  });

  const summary = await getPartySummary(created.id);
  if (!summary) throw new PartyInvariantError('客户/供应商创建后读取失败');
  return summary;
}

export async function updateParty(
  id: string,
  data: UpdatePartyData,
  actor: AuditActor,
): Promise<PartySummary> {
  return db.$transaction(async (tx) => {
    const target = await tx.party.findUnique({
      where: { id },
      select: {
        id: true,
        type: true,
        _count: {
          select: {
            customerOrders: true,
            purchaseOrders: true,
          },
        },
      },
    });
    if (!target) throw new PartyInvariantError('目标客户/供应商不存在');

    if (
      supportsCustomer(target.type) &&
      !supportsCustomer(data.type) &&
      target._count.customerOrders > 0
    ) {
      throw new PartyInvariantError(
        '该主数据已有工单关联，不能移除客户类型；可改为“客户/供应商”',
      );
    }
    if (
      supportsSupplier(target.type) &&
      !supportsSupplier(data.type) &&
      target._count.purchaseOrders > 0
    ) {
      throw new PartyInvariantError(
        '该主数据已有采购单关联，不能移除供应商类型；可改为“客户/供应商”',
      );
    }

    const beforeRow = await tx.party.findUnique({ where: { id }, select: PARTY_SELECT });
    const before = beforeRow ? normalizePartyRow(beforeRow) : null;
    await tx.party.update({
      where: { id },
      data: {
        type: data.type,
        code: data.code,
        name: data.name,
        shortName: data.shortName,
      },
      select: { id: true },
    });

    const existingContact = await tx.partyContact.findFirst({
      where: { partyId: id, isPrimary: true },
      select: { id: true },
    });
    const contact = primaryContactData(data);
    if (contact && existingContact) {
      await tx.partyContact.update({
        where: { id: existingContact.id },
        data: contact,
      });
    } else if (contact) {
      await tx.partyContact.create({
        data: { ...contact, partyId: id },
      });
    } else if (existingContact) {
      await tx.partyContact.delete({ where: { id: existingContact.id } });
    }

    const existingAddress = await tx.partyAddress.findFirst({
      where: { partyId: id, isDefault: true },
      select: { id: true },
    });
    const address = defaultAddressData(data);
    if (address && existingAddress) {
      await tx.partyAddress.update({
        where: { id: existingAddress.id },
        data: address,
      });
    } else if (address) {
      await tx.partyAddress.create({
        data: { ...address, partyId: id },
      });
    } else if (existingAddress) {
      await tx.partyAddress.delete({ where: { id: existingAddress.id } });
    }
    const afterRow = await tx.party.findUnique({ where: { id }, select: PARTY_SELECT });
    if (!afterRow) throw new PartyInvariantError('客户/供应商保存后读取失败');
    const after = normalizePartyRow(afterRow);
    await writeAuditLogInTx(tx, {
      actor, action: 'UPDATE', entityType: 'Party', entityId: id, before, after,
      requestMetadata: { source: 'owner-parties.updatePartyAction', route: `/owner/parties/${id}` },
    });
    return after;
  });
}

export async function setPartyActive(
  id: string,
  isActive: boolean,
): Promise<PartySummary> {
  const target = await getPartySummary(id);
  if (!target) throw new PartyInvariantError('目标客户/供应商不存在');
  if (target.isActive === isActive) return target;

  return db.party.update({
    where: { id },
    data: { isActive },
    select: PARTY_SELECT,
  }).then(normalizePartyRow);
}

export function formatPartyAddress(
  address: PartyAddressSummary | null,
): string | null {
  if (!address) return null;
  const parts = [
    address.province,
    address.city,
    address.district,
    address.detail,
  ].filter(Boolean);
  return parts.length ? parts.join('') : null;
}
