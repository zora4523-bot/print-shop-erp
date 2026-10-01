'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

/**
 * 业主 2026-10-02：点「打印」即记已打印。打印在新标签页完成并记录，回到本页时刷新一次，
 * 待打印提示随之消失。返回的函数挂在打印入口的 onClick 上；没点过打印入口不刷新。
 */
export function useRefreshAfterPrint(): () => void {
  const router = useRouter();
  const armed = useRef(false);
  useEffect(() => {
    const refresh = () => {
      if (!armed.current || document.visibilityState !== 'visible') return;
      armed.current = false;
      router.refresh();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [router]);
  return useCallback(() => { armed.current = true; }, []);
}
