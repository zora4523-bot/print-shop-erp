'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Laptop, Moon, Sun, SunMoon } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'erp-theme';
const THEME_EVENT = 'erp-theme-change';
const subscribeToHydration = () => () => undefined;

function currentTheme(): ThemeMode {
  if (typeof document === 'undefined') return 'system';
  const theme = document.documentElement.dataset.theme;
  return theme === 'light' || theme === 'dark' ? theme : 'system';
}

function applyTheme(theme: ThemeMode, persist = true) {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = theme === 'dark' || (theme === 'system' && prefersDark);
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  if (persist) localStorage.setItem(STORAGE_KEY, theme);
  window.dispatchEvent(new Event(THEME_EVENT));
}

function subscribeToTheme(listener: () => void) {
  window.addEventListener(THEME_EVENT, listener);
  return () => window.removeEventListener(THEME_EVENT, listener);
}

export function ThemeToggle() {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const restoreFocusOnClose = useRef(false);
  // SSR HTML is visible before the menu can handle pointer events.
  const hydrated = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  const theme = useSyncExternalStore(
    subscribeToTheme,
    currentTheme,
    () => 'system',
  );

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const syncSystemTheme = () => {
      if (currentTheme() === 'system') applyTheme('system', false);
    };
    media.addEventListener('change', syncSystemTheme);
    return () => media.removeEventListener('change', syncSystemTheme);
  }, []);

  return (
    <DropdownMenu
      onOpenChange={(open, details) => {
        // 关闭动画中的鼠标离开会补发 trigger-hover，不能覆盖 Escape 的焦点返回。
        if (open || details.reason !== 'trigger-hover') {
          restoreFocusOnClose.current = !open && details.reason === 'escape-key';
        }
      }}
      onOpenChangeComplete={(open) => {
        // Escape 关闭完成后恢复焦点；点击页面其他位置时不抢焦点。
        if (!open && restoreFocusOnClose.current) {
          triggerRef.current?.focus({ preventScroll: true });
          restoreFocusOnClose.current = false;
        }
      }}
    >
      <DropdownMenuTrigger
        ref={triggerRef}
        disabled={!hydrated}
        aria-label="切换界面主题"
        title="切换界面主题"
        className={buttonVariants({
          variant: 'ghost',
          size: 'icon',
          className: 'size-11',
        })}
      >
        <SunMoon aria-hidden className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuGroup>
          <DropdownMenuLabel>界面主题</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(value) => applyTheme(value as ThemeMode)}
        >
          <DropdownMenuRadioItem value="light">
            <Sun aria-hidden />
            浅色
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon aria-hidden />
            暗色
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <Laptop aria-hidden />
            跟随系统
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
