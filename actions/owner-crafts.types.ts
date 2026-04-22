// Types extracted from actions/owner-crafts.ts so client components can
// import them without pulling the Prisma runtime into the browser bundle.
// Same pattern as actions/owner-accounts.types.ts — a 'use server' module
// may only export async functions, so any other export leaks the server
// graph or is silently dropped at RSC compile time.

export type CraftMutationResult =
  | { status: 'success' }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; message: string };
