// Types extracted from actions/owner-notifications.ts so client components can
// import them without transitively pulling the Prisma runtime into the
// browser bundle. A 'use server' module may only export async functions —
// anything else (even a TypeScript type) leaks the server graph to the
// client when Turbopack resolves the import.

export type NotificationMutationResult =
  | { status: 'success' }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; message: string };

export type ChannelTestResult =
  | { status: 'success'; mock: boolean }
  | { status: 'error'; message: string };
