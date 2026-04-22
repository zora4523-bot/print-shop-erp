import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Runtime PrismaClient instances pass the @prisma/adapter-pg adapter explicitly
// (see prisma/seed.ts and future lib/db.ts). The Prisma 7 CLI needs
// datasource.url for `migrate`/`db pull`/etc.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL!,
  },
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
});
