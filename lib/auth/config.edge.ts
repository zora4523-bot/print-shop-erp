import type { NextAuthConfig } from 'next-auth';
import { Role } from '../../generated/prisma/enums';
import type { WorkerType, MachineType } from '../../generated/prisma/enums';

type LegacyAdminRole = 'OWNER' | 'FOREMAN';

// Existing JWT sessions can live for 30 days. During the role migration,
// normalize legacy administrator claims so a deploy never locks out a signed-in
// OWNER/FOREMAN before their browser receives a freshly issued ADMIN token.
export function normalizeSessionRole(role: Role | LegacyAdminRole): Role {
  return role === 'OWNER' || role === 'FOREMAN' ? Role.ADMIN : role;
}

const LEGACY_ADMIN_DISPLAY_NAMES = new Set(['老板', '车间主管']);

// The original seed used role titles as personal display names. Only rewrite
// those exact legacy defaults; real names and nicknames remain untouched.
export function normalizeSessionDisplayName(
  role: Role,
  displayName: string,
): string {
  return role === Role.ADMIN && LEGACY_ADMIN_DISPLAY_NAMES.has(displayName)
    ? '管理员'
    : displayName;
}

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
      draftSessionScope?: string;
    };
  }
}

// `next-auth/jwt` is just a re-export shim; the real JWT interface lives in
// `@auth/core/jwt`. TS refuses augmentation on the shim but accepts it here.
declare module '@auth/core/jwt' {
  interface JWT {
    draftSessionScope?: string;
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
        token.draftSessionScope = crypto.randomUUID();
        token.username = user.username;
        token.displayName = user.displayName;
        token.role = user.role;
        token.workerType = user.workerType;
        token.machineType = user.machineType;
      }
      if (token.role) {
        token.role = normalizeSessionRole(token.role as Role | LegacyAdminRole);
      }
      if (token.role && token.displayName) {
        token.displayName = normalizeSessionDisplayName(
          token.role,
          token.displayName,
        );
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.draftSessionScope = token.draftSessionScope;
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
