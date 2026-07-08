import type { NextAuthConfig } from 'next-auth';
import type { Role, WorkerType, MachineType } from '../../generated/prisma/client';

// Module augmentations live here so the compiler picks them up from every
// callsite that transitively imports the auth config (which is ~everywhere).
declare module 'next-auth' {
  interface User {
    id: string;
    username: string;
    displayName: string;
    role: Role;
    workerType: WorkerType | null;
    machineType: MachineType | null;
  }

  interface Session {
    user: {
      id: string;
      username: string;
      displayName: string;
      role: Role;
      workerType: WorkerType | null;
      machineType: MachineType | null;
    };
  }
}

// `next-auth/jwt` is just a re-export shim; the real JWT interface lives in
// `@auth/core/jwt`. TS refuses augmentation on the shim but accepts it here.
declare module '@auth/core/jwt' {
  interface JWT {
    username: string;
    displayName: string;
    role: Role;
    workerType: WorkerType | null;
    machineType: MachineType | null;
  }
}

// NB: edge-safe. Middleware imports this file, so it MUST NOT transitively
// import Prisma, bcryptjs, or any Node-only module. Credentials provider with
// DB access lives in config.ts (full) and runs only in Node route handlers.
export const authConfigEdge = {
  session: {
    strategy: 'jwt',
    // 30 天免登（DECISIONS 2026-07-08 覆盖原决策 C 的 7 天）：师傅只用
    // 个人微信、无免密方案，拉长会话减少扫码报工时的重复登录。撤销仍
    // 靠 AUTH_SECRET rotate。
    maxAge: 60 * 60 * 24 * 30,
  },
  trustHost: true,
  pages: {
    signIn: '/login',
  },
  providers: [],
  callbacks: {
    async jwt({ token, user }) {
      // On initial sign-in `user` is populated by the credentials authorize()
      // result. On subsequent requests only `token` is present.
      if (user) {
        token.username = user.username;
        token.displayName = user.displayName;
        token.role = user.role;
        token.workerType = user.workerType;
        token.machineType = user.machineType;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
        session.user.username = token.username;
        session.user.displayName = token.displayName;
        session.user.role = token.role;
        session.user.workerType = token.workerType;
        session.user.machineType = token.machineType;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
