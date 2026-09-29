'use client';

import { useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ConfirmActionController, ConfirmActionDialog } from '@/components/ui-business';

/**
 * 新建工单页头「返回工单列表」的站内离开确认。
 *
 * `useOrderFormLeaveGuard` 只挂 `beforeunload`，拦不住 Next 客户端导航；页头返回
 * 是站内链接，所以在 `onNavigate` 里判定：有未保存内容时取消本次导航，弹出与改单
 * 页一致的「放弃修改并离开」确认层（Codex 复审 2026-09-30：选好设计文件未提交时
 * 点返回会静默丢失文件）。判定口径与 `beforeunload` 相同，另计批量工作台里其他
 * 工单尚未上传的文件。确认离开前先把最新表单值写入本地草稿。
 */
export function useOrderFormLeaveConfirm({
  href,
  protectedLeave,
  pendingFileCount,
  otherOrdersHaveUnsavedFiles,
  persistDraft,
}: {
  href: string;
  /** 与 beforeunload 相同的判定（本单有改动或未上传文件且尚未提交）。 */
  protectedLeave: boolean;
  pendingFileCount: number;
  otherOrdersHaveUnsavedFiles: boolean;
  persistDraft: () => void;
}): { onNavigate: (event: { preventDefault(): void }) => void; dialog: ReactNode } {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const sourceRef = useRef<HTMLElement | null>(null);
  const guarded = protectedLeave || otherOrdersHaveUnsavedFiles;

  const consequences = [
    ...(pendingFileCount > 0 ? [`本单 ${pendingFileCount} 个未上传的设计文件将丢失。`] : []),
    ...(otherOrdersHaveUnsavedFiles ? ['其他工单中未上传的设计文件将丢失。'] : []),
    '已填写的内容保留在本机草稿中，下次新建时可继续。',
  ];

  return {
    onNavigate: (event) => {
      if (!guarded) return;
      event.preventDefault();
      sourceRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setOpen(true);
    },
    dialog: (
      <ConfirmActionController
        level="L2"
        open={open}
        onOpenChange={setOpen}
        focusReturnRef={sourceRef}
        cancelLabel="继续编辑"
        onConfirm={() => {
          persistDraft();
          setOpen(false);
          router.push(href);
        }}
      >
        <ConfirmActionDialog
          action="放弃修改并离开"
          changes={[]}
          consequences={consequences}
          confirmText="放弃修改并离开"
          danger
        />
      </ConfirmActionController>
    ),
  };
}
