// Types extracted from actions/owner-accounts.ts so client components can
// import them without transitively pulling the Prisma runtime into the
// browser bundle. A 'use server' module may only export async functions —
// anything else (even a TypeScript type) leaks the server graph to the
// client when Turbopack resolves the import.

export type AccountMutationResult =
  | { status: 'success' }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; message: string };
