import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { authConfigEdge } from './config.edge';
import { loginSchema } from './schemas';

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfigEdge,
  providers: [
    Credentials({
      credentials: {
        username: { label: '用户名' },
        password: { label: '密码', type: 'password' },
      },
      async authorize(raw) {
        const parsed = loginSchema.safeParse(raw);
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
