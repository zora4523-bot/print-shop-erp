export function shouldProtectOrderFormLeave(args: {
  enabled: boolean;
  dirty: boolean;
  pendingFileCount: number;
  submitted: boolean;
}): boolean {
  return (
    args.enabled &&
    !args.submitted &&
    (args.dirty || args.pendingFileCount > 0)
  );
}
