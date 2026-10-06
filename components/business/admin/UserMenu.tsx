'use client';

import Link from 'next/link';
import { useRef } from 'react';
import { ChevronDown, KeyRound, LogOut, UserCircle } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { buttonVariants } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { signOutAction } from '@/actions/account';

export type UserMenuProps = {
  displayName: string;
  roleLabel: string;
};

export function UserMenu({ displayName, roleLabel }: UserMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const restoreFocusOnClose = useRef(false);
  const initial = displayName.trim().charAt(0) || '·';

  return (
    <DropdownMenu
      onOpenChange={(open, details) => {
        // 关闭动画结束前保留 Escape 的关闭原因。
        if (open || details.reason !== 'trigger-hover') {
          restoreFocusOnClose.current = !open && details.reason === 'escape-key';
        }
      }}
      onOpenChangeComplete={(open) => {
        if (!open && restoreFocusOnClose.current) {
          triggerRef.current?.focus({ preventScroll: true });
          restoreFocusOnClose.current = false;
        }
      }}
    >
      <DropdownMenuTrigger
        ref={triggerRef}
        aria-label={`用户菜单：${displayName}`}
        className={buttonVariants({
          variant: 'ghost',
          className: 'min-h-11 min-w-11 gap-2 px-2',
        })}
      >
        <Avatar className="size-7 after:border-0">
          <AvatarFallback className="bg-muted text-foreground text-xs font-semibold">
            {initial}
          </AvatarFallback>
        </Avatar>
        <span
          className="hidden min-w-0 max-w-32 truncate md:inline"
          title={displayName}
        >
          {displayName}
        </span>
        <ChevronDown
          aria-hidden
          className="size-3.5 shrink-0 text-muted-foreground"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sticky className="w-56 max-w-(--available-width)">
        {/* DropdownMenuGroup 为标签提供 Base UI 分组上下文。 */}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center gap-2">
            <UserCircle aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex min-w-0 flex-col">
              <span className="admin-wrap-anywhere text-sm font-medium">{displayName}</span>
              <span className="text-xs text-muted-foreground">{roleLabel}</span>
            </span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/account/password" />}>
          <KeyRound aria-hidden className="size-4" />
          <span>修改密码</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {/* 提交期间保留菜单和表单，直到 signOutAction 完成页面跳转。 */}
        <form action={signOutAction}>
          <DropdownMenuItem
            nativeButton
            render={<button type="submit" data-native-button-reason="共享菜单项负责样式与键盘行为，原生提交按钮保留退出表单提交" />}
            closeOnClick={false}
            data-slot="user-menu-logout"
            className="w-full"
          >
            <LogOut aria-hidden className="size-4" />
            <span>退出登录</span>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
