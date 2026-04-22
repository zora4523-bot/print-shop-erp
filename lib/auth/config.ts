import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authConfigEdge } from './config.edge';

const credentialsSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(8).max(256),
});

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfigEdge,
  providers: [
    Credentials({
      credentials: {
        username: { label: '用户名' },
        password: { label: '密码', type: 'password' },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const { username, password } = parsed.data;
        const user = await db.user.findUnique({ where: { username } });
        if (!user || !user.isActive) return null;

        const ok = await bcrypt.compare(password, user.password);
        if (!ok) return null;

        return {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          role: user.role,
          workerType: user.workerType,
          machineType: user.machineType,
        };
      },
    }),
  ],
});
