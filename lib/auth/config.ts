import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { authConfigEdge } from './config.edge';
import { authorizeCredentials } from './credentials';

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfigEdge,
  providers: [
    Credentials({
      credentials: {
        username: { label: '用户名' },
        password: { label: '密码', type: 'password' },
      },
      authorize: authorizeCredentials,
    }),
  ],
});
