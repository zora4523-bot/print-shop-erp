import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// Prisma 7 rust-free client requires a driver adapter. Singleton pattern
// avoids pool exhaustion under Next.js dev hot-reload (each reload would
// otherwise spawn a fresh client).
declare global {
  var __prisma: PrismaClient | undefined;
}

function makeClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set');
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

export const db: PrismaClient = globalThis.__prisma ?? makeClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.__prisma = db;
}
