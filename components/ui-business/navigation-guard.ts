'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { setRouterTransitionListener } from './navigation-guard-transition';

/**
 * 共享导航守卫原语（2026-10-04 全应用导航守卫，docs/ui-规范.md §8.3）。
 *
 * 只负责「判定 + 拦截 + 回调」，确认层由调用方用 ConfirmActionController 渲染：
 * - 站内链接：document capture 阶段拦截同源 `<a href>` 的普通左键点击，早于 Next Link
 *   与页面自己的 onClick，因此侧栏、面包屑、顶栏菜单及正文链接走同一条判定；
 * - 浏览器后退 / 前进：Navigation API `navigate` 事件里取消 traverse（发生在 App Router
 *   收到 popstate 之前，不插入重复历史、不改写 history.state）。不支持 Navigation API 的
 *   浏览器只保留链接与 beforeunload 保护；
 * - 刷新 / 关闭：beforeunload（浏览器原生确认，不能自定义文案）。
 *
 * 多个守卫同时挂载时：按挂载（effect 注册）顺序，**最后注册**且 `when && shouldBlock()`
 * 为真的守卫独自决定这次导航——只有它的 onBlocked 被调用、只弹一个确认层；它若已
 * release() 则直接放行，不再询问更早的守卫。beforeunload 是浏览器统一的原生确认，
 * 任一守卫需要即拦。
 *
 * 确认后的放行是一次性的、绑定到那一次导航（全局，所有守卫都认）：`resume()` 重放的
 * 那一次点击、按 key 恢复的那一次 traverse、`leaveDocument()` 发起的那一次整页加载。
 * 重放被链接自己取消、traverse 结束 / 失败 / 被中止后，守卫照常布防。`release()` 则是
 * 「内容已安全」（例如保存成功）的整体解除，持续到 `when` 再次由 false 变 true。
 */

export type BlockedNavigationKind = 'link' | 'traverse';

export type BlockedNavigation = {
  kind: BlockedNavigationKind;
  /** 目标绝对地址（展示 / 改用 router.push 时用）。 */
  href: string;
  /** 被拦下的链接；后退 / 前进为 null。确认层取消后用于焦点返回。 */
  source: HTMLAnchorElement | null;
  /**
   * 只放行这一次并按原样继续：链接重放原点击（保留 Next Link 的 replace / scroll 与 pending 状态），
   * 历史按原条目 key 回到目标。之后的导航仍受保护。
   */
  resume: () => void;
};

export type NavigationGuardOptions = {
  /** 是否布防。由 false 变 true 时清除此前的 release()。 */
  when: boolean;
  /** 事件发生时的最新判定（读 ref，避免渲染滞后）；默认始终拦截。 */
  shouldBlock?: () => boolean;
  /** 被拦下后的回调：调用方弹确认层，确认后 resume()，或 release() 再自行跳转。 */
  onBlocked: (navigation: BlockedNavigation) => void;
  /**
   * 刷新 / 关闭保护，默认与 `when` 相同。传函数时在整个挂载期监听并实时判定
   * （用于「保存中不弹站内确认，但仍要防刷新」的页面）。
   */
  blockUnload?: boolean | (() => boolean);
};

export type NavigationGuard = {
  /** 内容已安全时整体解除：之后的链接、后退 / 前进与 beforeunload 都不再拦截，直到 `when` 重新由 false 变 true。 */
  release: () => void;
  isReleased: () => boolean;
};

/** 放在确认层等容器上，容器内的链接不经过守卫（例如守卫自己的确认层、自带确认的链接）。 */
export const NAVIGATION_GUARD_SKIP_ATTRIBUTE = 'data-navigation-guard-skip';

type GuardEntry = {
  armed: boolean;
  released: boolean;
  shouldBlock: () => boolean;
  onBlocked: (navigation: BlockedNavigation) => void;
};

type NavigationResult = { committed: Promise<unknown>; finished: Promise<unknown> };
type BrowserNavigation = EventTarget & { traverseTo: (key: string) => NavigationResult };
type BrowserNavigateEvent = Event & {
  navigationType: string;
  destination: { key: string; url: string; sameDocument: boolean };
};

/** 同源且路径或查询串不同才算离开本页；只差 hash、外链或无法解析都不拦。 */
export function isGuardedNavigationDestination(current: string, next: string): boolean {
  try {
    const from = new URL(current);
    const to = new URL(next, from);
    return from.origin === to.origin && (from.pathname !== to.pathname || from.search !== to.search);
  } catch {
    return false;
  }
}

const registry: GuardEntry[] = [];
let detach: (() => void) | null = null;
/** One-shot passes for an already confirmed navigation, honoured by every guard. */
let linkPass: HTMLAnchorElement | null = null;
/** Each resumed traversal is its own request: only it may consume or clear its pass. */
let traversePass: { key: string } | null = null;

/**
 * Reload-prompt pass for one confirmed document navigation. It is bound to the
 * navigation's lifecycle, not to a timer, because WebKit dispatches beforeunload
 * after asynchronous policy checks (later than the task that started it):
 * - the first beforeunload event after the grant is covered for every guard
 *   (all listeners of that one dispatch), later events are not;
 * - it is revoked when the document evidently stays: user interaction
 *   (pointerdown / keydown), the page becoming visible again, or a
 *   back/forward-cache restore (pageshow persisted); pagehide ends it too;
 * - a confirmed link the client router took over keeps it until that
 *   navigation commits a new URL in this document (or falls back to a full
 *   load, which the pass then covers);
 * - UNLOAD_PASS_FALLBACK_MS bounds it as a safety net if none of these happen
 *   (e.g. a download or a 204 response that keeps the page without input).
 */
const UNLOAD_PASS_FALLBACK_MS = 10_000;
let unloadPass: { event: Event | null; revoke: () => void } | null = null;

function revokeUnloadPass() {
  unloadPass?.revoke();
}

function grantUnloadPass() {
  revokeUnloadPass();
  const onVisibility = () => {
    if (document.visibilityState === 'visible') revoke();
  };
  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) revoke();
  };
  const timer = setTimeout(() => revoke(), UNLOAD_PASS_FALLBACK_MS);
  const pass = { event: null as Event | null, revoke };
  function revoke() {
    clearTimeout(timer);
    document.removeEventListener('pointerdown', revoke, true);
    document.removeEventListener('keydown', revoke, true);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pageshow', onPageShow);
    window.removeEventListener('pagehide', revoke);
    if (unloadPass === pass) unloadPass = null;
  }
  document.addEventListener('pointerdown', revoke, true);
  document.addEventListener('keydown', revoke, true);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pageshow', onPageShow);
  window.addEventListener('pagehide', revoke);
  unloadPass = pass;
  return pass;
}

/** Whether this beforeunload belongs to the confirmed navigation (first one after the grant). */
function unloadPassCovers(event: Event): boolean {
  if (!unloadPass) return false;
  if (unloadPass.event === null) unloadPass.event = event;
  return unloadPass.event === event;
}

/** True while a confirmed link is being replayed (its own onNavigate guard should let it through). */
export function isConfirmedNavigationInProgress(): boolean {
  return linkPass !== null;
}

/**
 * Full-document navigation after the user confirmed leaving: no guard (of any
 * component) prompts again for this navigation. `assign` is injectable for tests.
 */
export function leaveDocument(
  href: string,
  assign: (href: string) => void = (target) => window.location.assign(target),
): void {
  grantUnloadPass();
  assign(href);
}

function decidingGuard(): GuardEntry | null {
  for (let index = registry.length - 1; index >= 0; index -= 1) {
    const entry = registry[index];
    if (entry.armed && entry.shouldBlock()) return entry;
  }
  return null;
}

function guardedLink(event: MouseEvent): HTMLAnchorElement | null {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    !(event.target instanceof Element)
  ) {
    return null;
  }
  const link = event.target.closest('a[href]');
  if (
    !(link instanceof HTMLAnchorElement) ||
    (link.target && link.target !== '_self') ||
    link.hasAttribute('download') ||
    link.closest(`[${NAVIGATION_GUARD_SKIP_ATTRIBUTE}]`) ||
    !isGuardedNavigationDestination(location.href, link.href)
  ) {
    return null;
  }
  return link;
}

function attachDocumentListeners(): () => void {
  const onClick = (event: MouseEvent) => {
    const link = guardedLink(event);
    if (!link || link === linkPass) return;
    const entry = decidingGuard();
    if (!entry || entry.released) return;
    event.preventDefault();
    event.stopPropagation();
    entry.onBlocked({
      kind: 'link',
      href: link.href,
      source: link,
      resume: () => {
        linkPass = link;
        // A cancelled click is ambiguous: Next Link cancels it when it takes the
        // navigation over (and may later fall back to location.assign, e.g. when
        // the RSC fetch fails), a consumer's onNavigate.preventDefault() cancels
        // it for real. Next reports a takeover synchronously through the public
        // onRouterTransitionStart hook (instrumentation-client.ts).
        let tookOver = false;
        setRouterTransitionListener(() => {
          tookOver = true;
        });
        try {
          const pass = grantUnloadPass();
          const event = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
          const native = link.dispatchEvent(event);
          if (!native && !tookOver) pass.revoke();
        } finally {
          linkPass = null;
          setRouterTransitionListener(null);
        }
      },
    });
  };
  // Read once per attachment so tests (and browsers) without the API degrade cleanly.
  const navigation = (window as Window & { navigation?: BrowserNavigation }).navigation;
  const onNavigate = (rawEvent: Event) => {
    const event = rawEvent as BrowserNavigateEvent;
    // A confirmed client navigation committed its new URL in this document: no
    // unload follows, so the reload pass ends here (history-state syncs that keep
    // the URL do not count).
    if (
      event.navigationType !== 'traverse' &&
      event.destination.sameDocument &&
      isGuardedNavigationDestination(location.href, event.destination.url)
    ) {
      revokeUnloadPass();
    }
    if (
      event.defaultPrevented ||
      event.navigationType !== 'traverse' ||
      !event.cancelable ||
      !event.destination.sameDocument ||
      !isGuardedNavigationDestination(location.href, event.destination.url)
    ) {
      return;
    }
    if (traversePass !== null && event.destination.key === traversePass.key) {
      traversePass = null;
      return;
    }
    const entry = decidingGuard();
    if (!entry || entry.released) return;
    event.preventDefault();
    const { key, url } = event.destination;
    entry.onBlocked({
      kind: 'traverse',
      href: url,
      source: null,
      resume: () => {
        // The pass names this history entry only and is consumed by its
        // navigate event; any other destination stays guarded meanwhile.
        const request = { key };
        traversePass = request;
        // Settled (success, failure or abort) without its navigate event — e.g.
        // traverseTo() the current entry — must not leave the pass behind, and
        // an older request must never clear a newer one.
        const settle = () => {
          if (traversePass === request) traversePass = null;
        };
        const result = navigation!.traverseTo(key);
        void result.committed.catch(() => undefined);
        void result.finished.then(settle, settle);
      },
    });
  };
  document.addEventListener('click', onClick, true);
  navigation?.addEventListener('navigate', onNavigate);
  return () => {
    document.removeEventListener('click', onClick, true);
    navigation?.removeEventListener('navigate', onNavigate);
  };
}

const ALWAYS = () => true;

export function useNavigationGuard({
  when,
  shouldBlock = ALWAYS,
  onBlocked,
  blockUnload = when,
}: NavigationGuardOptions): NavigationGuard {
  const entryRef = useRef<GuardEntry>({ armed: false, released: false, shouldBlock: ALWAYS, onBlocked: () => undefined });
  // Event handlers read the latest callbacks without re-registering (registration order is the priority).
  useLayoutEffect(() => {
    const entry = entryRef.current;
    entry.shouldBlock = shouldBlock;
    entry.onBlocked = onBlocked;
  });

  useLayoutEffect(() => {
    const entry = entryRef.current;
    entry.armed = when;
    if (when) entry.released = false;
  }, [when]);

  useEffect(() => {
    const entry = entryRef.current;
    registry.push(entry);
    if (registry.length === 1) detach = attachDocumentListeners();
    return () => {
      registry.splice(registry.indexOf(entry), 1);
      if (registry.length === 0) {
        detach?.();
        detach = null;
        // No guard left: an unconsumed pass must not carry over to the next page.
        traversePass = null;
        revokeUnloadPass();
      }
    };
  }, []);

  const unloadPredicate = typeof blockUnload === 'function' ? blockUnload : null;
  const unloadRef = useRef(unloadPredicate);
  useLayoutEffect(() => {
    unloadRef.current = unloadPredicate;
  });
  const listenUnload = unloadPredicate ? true : Boolean(blockUnload);
  useEffect(() => {
    if (!listenUnload) return;
    const entry = entryRef.current;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (entry.released || unloadPassCovers(event) || (unloadRef.current && !unloadRef.current())) return;
      event.preventDefault();
      // Legacy signal still required by some browsers before showing the native prompt.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [listenUnload]);

  const release = useCallback(() => {
    entryRef.current.released = true;
  }, []);
  const isReleased = useCallback(() => entryRef.current.released, []);
  return useMemo(() => ({ release, isReleased }), [release, isReleased]);
}
