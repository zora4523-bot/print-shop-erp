import type { MutationResult } from '@/lib/admin/action-helpers';

// 'use server' 模块只能导出 async 函数，返回类型放这里（CLAUDE.md §15.3）。
export type BackgroundJobMutationResult = MutationResult;
