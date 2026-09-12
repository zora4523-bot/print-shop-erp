export function requireReleasePrerequisite(reason: string | null | undefined): void {
  if (reason && process.env.E2E_RELEASE_MODE === '1') {
    throw new Error(`Release E2E prerequisite failed: ${reason}`);
  }
}
