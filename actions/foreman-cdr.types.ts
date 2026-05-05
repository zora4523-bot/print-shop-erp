// Mutation result types for foreman-cdr server actions. Kept in a
// separate file so RSC clients can `import type { ... }` without
// pulling the `'use server'` module.

export type CreateBundleResult =
  | {
      status: 'success';
      bundleId: string;
      // 绝对 URL（含 host），外协方复制粘贴用
      downloadUrl: string;
      // 相对路径 /api/cdr/bundles/<id>，同源链接 / E2E 用
      relativePath: string;
      expiresAt: string; // ISO
      fileCount: number;
      // OSS 真接入前 isMock=true，UI 在 detail 页显示&ldquo;OSS 未配置&rdquo; banner
      isMock: boolean;
    }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; message: string };
