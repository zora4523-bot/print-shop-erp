import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { describe, it, expect, vi } from 'vitest';
import { PrismaClient, type Prisma } from '../../generated/prisma/client';
const holder = vi.hoisted(() => ({ client: null as PrismaClient | null }));
vi.mock('../db', () => ({ db: { $transaction: (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => holder.client!.$transaction(callback) } }));
import { updateParty } from '../party';
const url = process.env.DATABASE_URL;
(url ? describe : describe.skip)('party audit atomicity', () => {
  it('rolls back party changes if the audit insert fails', async () => {
    const schema = `party_audit_${randomBytes(6).toString('hex')}`;
    const pg = new Client({ connectionString: url });
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }, { schema }) });
    holder.client = client;
    await pg.connect();
    try {
      await pg.query(`CREATE SCHEMA "${schema}"`);
      const enums = await pg.query("SELECT typname FROM pg_type JOIN pg_namespace n ON n.oid=typnamespace WHERE n.nspname='public' AND typtype='e'");
      for (const row of enums.rows) await pg.query(`CREATE DOMAIN "${schema}"."${row.typname}" AS public."${row.typname}"`);
      for (const table of ['Party','PartyContact','PartyAddress','Order','PurchaseOrder','BusinessAuditLog']) {
        await pg.query(`CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`);
      }
      await client.party.create({ data: { id: 'party', type: 'CUSTOMER', code: 'AUDIT_TEST', name: 'Before' } });
      await pg.query(`ALTER TABLE "${schema}"."BusinessAuditLog" ADD CONSTRAINT reject_test_audit CHECK (false)`);
      await expect(updateParty('party', {
        type: 'CUSTOMER', code: 'AUDIT_TEST', name: 'After', shortName: null,
        primaryContactName: null, primaryContactPhone: null, primaryContactWechat: null,
        defaultReceiverName: null, defaultReceiverPhone: null, defaultProvince: null,
        defaultCity: null, defaultDistrict: null, defaultAddressDetail: null,
      }, { id: 'admin', role: 'ADMIN', username: 'admin', displayName: 'Admin' })).rejects.toThrow('reject_test_audit');
      expect((await client.party.findUniqueOrThrow({ where: { id: 'party' } })).name).toBe('Before');
    } finally {
      await client.$disconnect();
      holder.client = null;
      await pg.query(`DROP SCHEMA "${schema}" CASCADE`);
      await pg.end();
    }
  }, 30_000);
});
