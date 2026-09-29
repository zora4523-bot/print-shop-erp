'use client';

import Link from 'next/link';
import { ChevronDown, KeyRound, LogOut, UserCircle } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button, buttonVariants } from '@/components/ui/button';
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

// Admin shell 顶栏右侧的用户下拉菜单——把&ldquo;用户名 / 角色 / 修改密码 /
// 退出登录&rdquo;收进一个 dropdown，替代之前一字排开的 inline links。
//
// 客户端组件：DropdownMenu 用 Base UI primitives 需要 hover/click 状态。
// signOutAction 是 server action，从 client 直调是 Next 16 标准模式。
//
// **a11y**：trigger 用 button + aria-label；DropdownMenu 内置 keyboard nav。
// 头像 fallback 取 displayName 第一个字符，无图也能识别。

export type UserMenuProps = {
  displayName: string;
  roleLabel: string;
};

export function UserMenu({ displayName, roleLabel }: UserMenuProps) {
  const initial = displayName.trim().charAt(0) || '·';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`用户菜单：${displayName}`}
        className={buttonVariants({
          variant: 'ghost',
          className: 'h-11 min-w-11 gap-2 px-2',
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
      <DropdownMenuContent align="end" className="w-56">
        {/* DropdownMenuLabel 是 Base UI 的 MenuPrimitive.GroupLabel，必
            须在 <DropdownMenuGroup> 内（否则 MenuGroupRootContext 缺失，
            页面跑成 Runtime Error）。 */}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center gap-2">
            <UserCircle aria-hidden className="size-4 text-muted-foreground" />
            <span className="flex flex-col">
              <span className="text-sm font-medium">{displayName}</span>
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
        {/* signOutAction 进 form：禁 JS / 慢网络也能登出（保留 LogoutButton
            核心特性）。**不**包进 DropdownMenuItem——Base UI 的 MenuItem
            会和 form > button 嵌套互相劫持事件 + 弄丢 a11y role（实测
            E2E 找不到 menuitem name=退出登录）。直接平铺统一 Button，视觉
            对齐 DropdownMenuItem 的 padding/hover。 */}
        <form action={signOutAction} className="p-1">
          <Button
            type="submit"
            variant="ghost"
            data-slot="user-menu-logout"
            className="min-h-11 w-full cursor-default justify-start rounded-sm px-2 hover:bg-muted focus-visible:bg-muted active:translate-y-0"
          >
            <LogOut aria-hidden className="size-4" />
            <span>退出登录</span>
          </Button>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
