import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PartyType } from '../../generated/prisma/enums';

const { dbMock, txMock } = vi.hoisted(() => {
  const tx = {
    party: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    partyContact: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      findFirst: vi.fn(),
    },
    partyAddress: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      findFirst: vi.fn(),
    },
  };
  return {
    txMock: tx,
    dbMock: {
      businessCodeSequence: {
        upsert: vi.fn(),
      },
      party: {
        count: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      partyContact: {
        create: vi.fn(),
      },
      partyAddress: {
        create: vi.fn(),
      },
      $transaction: vi.fn((cb: (txArg: typeof tx) => unknown) => cb(tx)),
    },
  };
});

vi.mock('@/lib/db', () => ({ db: dbMock }));

import {
  createParty,
  formatPartyAddress,
  listParties,
  listPartiesPage,
  listCustomerPartyOptions,
  listSupplierPartyOptions,
  PartyInvariantError,
  setPartyActive,
  updateParty,
} from '../party';

const now = new Date('2026-06-28T00:00:00Z');

const makeParty = (over = {}) => ({
  id: 'party1',
  type: PartyType.CUSTOMER,
  code: 'CUST_001',
  name: '苹果福',
  shortName: '苹果',
  searchPinyin: null,
  searchPinyinInitials: null,
  isActive: true,
  createdAt: now,
  updatedAt: now,
  contacts: [
    {
      id: 'contact1',
      name: '王小姐',
      phone: '13800000000',
      wechat: null,
      isPrimary: true,
      sortOrder: 0,
    },
  ],
  addresses: [
    {
      id: 'addr1',
      receiverName: '王小姐',
      receiverPhone: '13800000000',
      province: '广东',
      city: '广州',
      district: '番禺',
      detail: '市桥街道 1 号',
      isDefault: true,
      sortOrder: 0,
    },
  ],
  ...over,
});

beforeEach(() => {
  dbMock.businessCodeSequence.upsert.mockReset();
  for (const fn of Object.values(dbMock.party)) fn.mockReset();
  dbMock.partyContact.create.mockReset();
  dbMock.partyAddress.create.mockReset();
  dbMock.$transaction.mockReset().mockImplementation((cb) => cb(txMock));
  for (const group of [
    txMock.party,
    txMock.partyContact,
    txMock.partyAddress,
  ]) {
    for (const fn of Object.values(group)) fn.mockReset();
  }
});

describe('listParties', () => {
  it('searches code, name, shortName, pinyin, contacts, phone, and address', async () => {
    dbMock.party.findMany.mockResolvedValue([]);

    await listParties({ q: '  苹果 ' });

    expect(dbMock.party.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              OR: expect.arrayContaining([
                { code: { contains: '苹果', mode: 'insensitive' } },
                { name: { contains: '苹果', mode: 'insensitive' } },
                { shortName: { contains: '苹果', mode: 'insensitive' } },
                { searchPinyin: { contains: '苹果', mode: 'insensitive' } },
                { searchPinyinInitials: { contains: '苹果', mode: 'insensitive' } },
                expect.objectContaining({ contacts: expect.any(Object) }),
                expect.objectContaining({ addresses: expect.any(Object) }),
              ]),
            },
          ],
        },
      }),
    );
  });

  it('keeps search relevance for default sorting', async () => {
    dbMock.party.findMany.mockResolvedValue([
      makeParty({ id: 'contains', name: '广州苹果福印刷' }),
      makeParty({ id: 'exact', name: '苹果福' }),
      makeParty({ id: 'prefix', name: '苹果福一店' }),
    ]);

    const rows = await listParties({ q: '苹果福' });

    expect(rows.map((row) => row.id)).toEqual(['exact', 'prefix', 'contains']);
  });
});

describe('listPartiesPage', () => {
  it('counts and fetches only the requested database page', async () => {
    dbMock.party.count.mockResolvedValue(41);
    dbMock.party.findMany.mockResolvedValue([
      makeParty({ id: 'last', code: 'PTY-000041' }),
    ]);

    const page = await listPartiesPage({
      page: 99,
      pageSize: 20,
      sort: 'updatedAt',
      direction: 'desc',
    });

    expect(page).toMatchObject({ total: 41, page: 3, pageCount: 3 });
    expect(page.rows.map((row) => row.id)).toEqual(['last']);
    expect(dbMock.party.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 40,
        take: 20,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      }),
    );
  });

  it('uses the same type and text filters for count and rows', async () => {
    dbMock.party.count.mockResolvedValue(1);
    dbMock.party.findMany.mockResolvedValue([makeParty()]);

    await listPartiesPage({
      q: '苹果',
      type: PartyType.CUSTOMER,
      page: 1,
      pageSize: 20,
      sort: 'default',
      direction: 'asc',
    });

    const expectedWhere = {
      AND: [
        { type: PartyType.CUSTOMER },
        expect.objectContaining({ OR: expect.any(Array) }),
      ],
    };
    expect(dbMock.party.count).toHaveBeenCalledWith({ where: expectedWhere });
    expect(dbMock.party.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expectedWhere, skip: 0, take: 20 }),
    );
  });
});

describe('listSupplierPartyOptions', () => {
  it('only asks for active SUPPLIER/BOTH rows and maps supplier labels', async () => {
    dbMock.party.findMany.mockResolvedValue([
      makeParty({ type: PartyType.SUPPLIER, code: 'SUP_001', name: '纸张供应商' }),
    ]);

    const options = await listSupplierPartyOptions();

    expect(dbMock.party.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          isActive: true,
          OR: [{ type: PartyType.SUPPLIER }, { type: PartyType.BOTH }],
        },
      }),
    );
    expect(options[0]).toMatchObject({
      code: 'SUP_001',
      name: '纸张供应商',
      contactName: '王小姐',
      contactPhone: '13800000000',
    });
  });
});

describe('listCustomerPartyOptions', () => {
  it('only asks for active CUSTOMER/BOTH rows and maps the default delivery facts', async () => {
    dbMock.party.findMany.mockResolvedValue([makeParty()]);

    const options = await listCustomerPartyOptions();

    expect(dbMock.party.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          isActive: true,
          OR: [{ type: PartyType.CUSTOMER }, { type: PartyType.BOTH }],
        },
      }),
    );
    expect(options[0]).toMatchObject({
      code: 'CUST_001',
      name: '苹果福',
      shortName: '苹果',
      receiverName: '王小姐',
      receiverPhone: '13800000000',
      receiverAddress: '广东广州番禺市桥街道 1 号',
    });
  });
});

describe('createParty', () => {
  it('generates a party code when the operator leaves it blank', async () => {
    dbMock.businessCodeSequence.upsert.mockResolvedValueOnce({ value: 8 });
    txMock.party.create.mockResolvedValue({ id: 'party1' });
    dbMock.party.findUnique.mockResolvedValue(makeParty({ code: 'PTY-000008' }));

    await createParty({
      type: PartyType.SUPPLIER,
      code: null,
      name: '纸张供应商',
      shortName: null,
      primaryContactName: null,
      primaryContactPhone: null,
      primaryContactWechat: null,
      defaultReceiverName: null,
      defaultReceiverPhone: null,
      defaultProvince: null,
      defaultCity: null,
      defaultDistrict: null,
      defaultAddressDetail: null,
    });

    expect(txMock.party.create.mock.calls[0][0].data.code).toBe('PTY-000008');
  });

  it('creates a party with primary contact and default address', async () => {
    txMock.party.create.mockResolvedValue({ id: 'party1' });
    dbMock.party.findUnique.mockResolvedValue(makeParty());

    await createParty({
      type: PartyType.CUSTOMER,
      code: 'CUST_001',
      name: '苹果福',
      shortName: null,
      primaryContactName: '王小姐',
      primaryContactPhone: '13800000000',
      primaryContactWechat: null,
      defaultReceiverName: '王小姐',
      defaultReceiverPhone: '13800000000',
      defaultProvince: '广东',
      defaultCity: '广州',
      defaultDistrict: '番禺',
      defaultAddressDetail: '市桥街道 1 号',
    });

    expect(txMock.party.create.mock.calls[0][0].data).toMatchObject({
      code: 'CUST_001',
      isActive: true,
    });
    expect(txMock.partyContact.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          partyId: 'party1',
          name: '王小姐',
          isPrimary: true,
        }),
      }),
    );
    expect(txMock.partyAddress.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          partyId: 'party1',
          detail: '市桥街道 1 号',
          isDefault: true,
        }),
      }),
    );
  });
});

describe('updateParty', () => {
  it('throws when target is missing', async () => {
    txMock.party.findUnique.mockResolvedValue(null);
    await expect(
      updateParty('missing', {
        type: PartyType.CUSTOMER,
        code: 'CUST_001',
        name: '苹果福',
        shortName: null,
        primaryContactName: null,
        primaryContactPhone: null,
        primaryContactWechat: null,
        defaultReceiverName: null,
        defaultReceiverPhone: null,
        defaultProvince: null,
        defaultCity: null,
        defaultDistrict: null,
        defaultAddressDetail: null,
      }, { id: 'admin', role: 'ADMIN', username: 'admin', displayName: 'Admin' }),
    ).rejects.toBeInstanceOf(PartyInvariantError);
  });

  it('refuses removing supplier capability when purchase orders reference the party', async () => {
    txMock.party.findUnique.mockResolvedValue({
      id: 'party1',
      type: PartyType.SUPPLIER,
      _count: { customerOrders: 0, purchaseOrders: 1 },
    });

    await expect(
      updateParty('party1', {
        type: PartyType.CUSTOMER,
        code: 'SUP_001',
        name: '纸张供应商',
        shortName: null,
        primaryContactName: null,
        primaryContactPhone: null,
        primaryContactWechat: null,
        defaultReceiverName: null,
        defaultReceiverPhone: null,
        defaultProvince: null,
        defaultCity: null,
        defaultDistrict: null,
        defaultAddressDetail: null,
      }, { id: 'admin', role: 'ADMIN', username: 'admin', displayName: 'Admin' }),
    ).rejects.toThrowError(/不能移除供应商类型/);
    expect(txMock.party.update).not.toHaveBeenCalled();
  });

  it('refuses removing customer capability when orders reference the party', async () => {
    txMock.party.findUnique.mockResolvedValue({
      id: 'party1',
      type: PartyType.BOTH,
      _count: { customerOrders: 1, purchaseOrders: 0 },
    });

    await expect(
      updateParty('party1', {
        type: PartyType.SUPPLIER,
        code: 'BOTH_001',
        name: '客户兼供应商',
        shortName: null,
        primaryContactName: null,
        primaryContactPhone: null,
        primaryContactWechat: null,
        defaultReceiverName: null,
        defaultReceiverPhone: null,
        defaultProvince: null,
        defaultCity: null,
        defaultDistrict: null,
        defaultAddressDetail: null,
      }, { id: 'admin', role: 'ADMIN', username: 'admin', displayName: 'Admin' }),
    ).rejects.toThrowError(/不能移除客户类型/);
    expect(txMock.party.update).not.toHaveBeenCalled();
  });
});

describe('setPartyActive', () => {
  it('returns existing row when active state is unchanged', async () => {
    dbMock.party.findUnique.mockResolvedValue(makeParty({ isActive: true }));

    const result = await setPartyActive('party1', true);

    expect(result.isActive).toBe(true);
    expect(dbMock.party.update).not.toHaveBeenCalled();
  });
});

describe('formatPartyAddress', () => {
  it('joins region and detail without dropping blanks', () => {
    expect(formatPartyAddress(makeParty().addresses[0])).toBe(
      '广东广州番禺市桥街道 1 号',
    );
  });
});
