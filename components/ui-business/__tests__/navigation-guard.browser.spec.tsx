import type { ComponentProps } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NAVIGATION_GUARD_SKIP_ATTRIBUTE,
  leaveDocument,
  useNavigationGuard,
  type BlockedNavigation,
  type NavigationGuard,
} from '../navigation-guard';

/**
 * 共享导航守卫原语（2026-10-04 全应用导航守卫）。原生 <a> 让测试能观察
 * 「被拦下 / 放行 / 重放」而不依赖 Next 路由；Navigation API 用替身驱动，
 * 因为 Vitest 浏览器模式在 iframe 里跑，原生 traverse 事件不可取消。
 */
type GuardProps = {
  name: string;
  when?: boolean;
  shouldBlock?: () => boolean;
  blockUnload?: boolean | (() => boolean);
  onBlocked?: (navigation: BlockedNavigation) => void;
};
const guards = new Map<string, NavigationGuard>();
const blocked: Array<{ guard: string } & BlockedNavigation> = [];
const followed = vi.fn();

function Guard({ name, when = true, shouldBlock, blockUnload, onBlocked }: GuardProps) {
  const guard = useNavigationGuard({
    when,
    shouldBlock,
    blockUnload,
    onBlocked: onBlocked ?? ((navigation) => { blocked.push({ guard: name, ...navigation }); }),
  });
  guards.set(name, guard);
  return null;
}

// Native anchors (not next/link) let the harness observe interception and replay directly.
function Anchor(props: ComponentProps<'a'>) {
  return <a {...props} />;
}

function Links() {
  const follow = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    followed(event.currentTarget.getAttribute('href'));
  };
  return (
    <nav>
      <Anchor href="/orders" onClick={follow}>工单列表</Anchor>
      <Anchor href="/orders" target="_blank" onClick={follow}>新标签</Anchor>
      <Anchor href="/orders" target="_self" onClick={follow}>本窗口</Anchor>
      <Anchor href="/orders/export" download onClick={follow}>导出</Anchor>
      <Anchor href="#section" onClick={follow}>本页锚点</Anchor>
      <Anchor href="?tab=a#x" onClick={follow}>同址查询</Anchor>
      <Anchor href="https://example.com/help" onClick={follow}>外部帮助</Anchor>
      <div {...{ [NAVIGATION_GUARD_SKIP_ATTRIBUTE]: '' }}>
        <Anchor href="/orders/confirm" onClick={follow}>确认层内链接</Anchor>
      </div>
      <Anchor href="/orders/nested" onClick={follow}><span>嵌套文字链接</span></Anchor>
    </nav>
  );
}

let host: HTMLDivElement;
let root: Root;
let originalNavigation: PropertyDescriptor | undefined;
let navigation: EventTarget & { traverseTo: ReturnType<typeof vi.fn> };
let finished: { resolve: () => void; reject: (error: unknown) => void };

function render(node: React.ReactNode) {
  flushSync(() => root.render(<>{node}<Links /></>));
}
function link(text: string): HTMLAnchorElement {
  return [...host.querySelectorAll('a')].find((anchor) => anchor.textContent === text)!;
}
function click(target: Element, init: MouseEventInit = {}) {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
  target.dispatchEvent(event);
  return event;
}
function traversal(key: string, url: string, cancelable = true) {
  const event = new Event('navigate', { cancelable });
  Object.assign(event, { navigationType: 'traverse', destination: { key, url, sameDocument: true } });
  navigation.dispatchEvent(event);
  return event;
}
function unload() {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
const at = (path: string) => new URL(path, location.href).href;

beforeEach(() => {
  blocked.length = 0;
  guards.clear();
  followed.mockReset();
  originalNavigation = Object.getOwnPropertyDescriptor(window, 'navigation');
  navigation = Object.assign(new EventTarget(), {
    traverseTo: vi.fn(() => ({
      committed: Promise.resolve(),
      finished: new Promise<void>((resolve, reject) => { finished = { resolve, reject }; }),
    })),
  });
  Object.defineProperty(window, 'navigation', { configurable: true, value: navigation });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  if (originalNavigation) Object.defineProperty(window, 'navigation', originalNavigation);
  else Reflect.deleteProperty(window, 'navigation');
});

describe('link interception', () => {
  it('blocks a plain same-origin left click before the link’s own handler runs', () => {
    render(<Guard name="A" />);
    const event = click(link('工单列表'));
    expect(event.defaultPrevented).toBe(true);
    expect(followed).not.toHaveBeenCalled();
    expect(blocked).toEqual([expect.objectContaining({ guard: 'A', kind: 'link', href: at('/orders') })]);
    expect(blocked[0].source).toBe(link('工单列表'));
  });

  it('blocks clicks on elements nested inside the link and target=_self links', () => {
    render(<Guard name="A" />);
    click(link('嵌套文字链接').querySelector('span')!);
    click(link('本窗口'));
    expect(blocked.map((entry) => entry.href)).toEqual([at('/orders/nested'), at('/orders')]);
    expect(followed).not.toHaveBeenCalled();
  });

  it.each([
    ['metaKey', { metaKey: true }],
    ['ctrlKey', { ctrlKey: true }],
    ['shiftKey', { shiftKey: true }],
    ['altKey', { altKey: true }],
    ['middle button', { button: 1 }],
  ] as const)('leaves %s clicks to the browser', (_label, init) => {
    render(<Guard name="A" />);
    click(link('工单列表'), init);
    expect(blocked).toEqual([]);
    expect(followed).toHaveBeenCalledOnce();
  });

  it.each(['新标签', '导出', '本页锚点', '外部帮助', '确认层内链接'])('does not intercept %s', (text) => {
    render(<Guard name="A" />);
    click(link(text));
    expect(blocked).toEqual([]);
    expect(followed).toHaveBeenCalledOnce();
  });

  it('treats a different query string on the same path as leaving', () => {
    render(<Guard name="A" />);
    click(link('同址查询'));
    expect(blocked).toEqual([expect.objectContaining({ kind: 'link' })]);
  });

  it('respects events another handler already cancelled', () => {
    render(<Guard name="A" />);
    const cancel = (event: Event) => event.preventDefault();
    window.addEventListener('click', cancel, { capture: true, once: true });
    click(link('工单列表'));
    expect(blocked).toEqual([]);
  });

  it('is inert when not armed or when shouldBlock() says the content is safe', () => {
    render(<Guard name="A" when={false} />);
    click(link('工单列表'));
    let dirty = false;
    render(<Guard name="A" shouldBlock={() => dirty} />);
    click(link('工单列表'));
    expect(blocked).toEqual([]);
    expect(followed).toHaveBeenCalledTimes(2);
    dirty = true;
    click(link('工单列表'));
    expect(blocked).toHaveLength(1);
  });

  it('resume() replays the original link once without reopening the guard', () => {
    render(<Guard name="A" />);
    click(link('工单列表'));
    blocked[0].resume();
    expect(followed).toHaveBeenCalledExactlyOnceWith('/orders');
    expect(blocked).toHaveLength(1);
  });

  it('a confirmed link only passes once: when its own handler cancels the replay, the guard stays armed', async () => {
    // The fixture links cancel their own default action, like Next Link onNavigate.preventDefault().
    render(<Guard name="A" />);
    click(link('工单列表'));
    blocked[0].resume();
    expect(followed).toHaveBeenCalledOnce();
    click(link('工单列表'));
    expect(blocked).toHaveLength(2);
    expect(traversal('prev', at('/orders')).defaultPrevented).toBe(true);
    // The replay's own reload pass only covers the task that replayed it.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(unload()).toBe(true);
  });
});

describe('browser back / forward (Navigation API)', () => {
  it('cancels a traversal without touching history and resumes by entry key', async () => {
    render(<Guard name="A" />);
    const before = { length: history.length, state: history.state, href: location.href };
    expect(traversal('prev', at('/orders')).defaultPrevented).toBe(true);
    expect(blocked).toEqual([expect.objectContaining({ kind: 'traverse', href: at('/orders'), source: null })]);
    expect({ length: history.length, state: history.state, href: location.href }).toEqual(before);
    blocked[0].resume();
    expect(navigation.traverseTo).toHaveBeenCalledExactlyOnceWith('prev');
    expect(traversal('prev', at('/orders')).defaultPrevented).toBe(false);
    finished.resolve();
  });

  it('a confirmed same-page query change does not disarm later edits, leaves or reloads', async () => {
    // e.g. price workspace: back from ?section=b to ?section=a keeps the editor mounted and dirty.
    render(<Guard name="A" />);
    expect(traversal('prev', at('?section=a')).defaultPrevented).toBe(true);
    blocked[0].resume();
    expect(traversal('prev', at('?section=a')).defaultPrevented).toBe(false);
    finished.resolve();
    await Promise.resolve();
    expect(traversal('prev-2', at('?section=z')).defaultPrevented).toBe(true);
    click(link('工单列表'));
    expect(blocked).toHaveLength(3);
    expect(unload()).toBe(true);
  });

  it('a confirmed traversal only lets its own history entry through', () => {
    render(<Guard name="A" />);
    traversal('prev', at('/orders'));
    blocked[0].resume();
    expect(traversal('other-entry', at('/orders/other')).defaultPrevented).toBe(true);
    expect(traversal('prev', at('/orders')).defaultPrevented).toBe(false);
    expect(traversal('prev', at('/orders')).defaultPrevented).toBe(true);
  });

  it('re-arms when the resumed traversal is aborted', async () => {
    render(<Guard name="A" />);
    traversal('prev', at('/orders'));
    blocked[0].resume();
    finished.reject(new DOMException('aborted', 'AbortError'));
    await vi.waitFor(() => expect(traversal('prev', at('/orders')).defaultPrevented).toBe(true));
  });

  it('ignores non-cancelable, same-page and push navigations', () => {
    render(<Guard name="A" />);
    expect(traversal('prev', at('/orders'), false).defaultPrevented).toBe(false);
    expect(traversal('hash', `${location.href.split('#')[0]}#section`).defaultPrevented).toBe(false);
    const push = new Event('navigate', { cancelable: true });
    Object.assign(push, { navigationType: 'push', destination: { key: '', url: at('/orders'), sameDocument: true } });
    navigation.dispatchEvent(push);
    expect(push.defaultPrevented).toBe(false);
    expect(blocked).toEqual([]);
  });

  it('keeps link and unload protection when the Navigation API is unavailable', () => {
    Object.defineProperty(window, 'navigation', { configurable: true, value: undefined });
    render(<Guard name="A" />);
    click(link('工单列表'));
    expect(blocked).toHaveLength(1);
    expect(unload()).toBe(true);
  });
});

describe('beforeunload, release and re-arm', () => {
  it('protects reload/close while armed and stops after unmount', () => {
    render(<Guard name="A" />);
    expect(unload()).toBe(true);
    flushSync(() => root.render(<Links />));
    expect(unload()).toBe(false);
  });

  it('supports a separate unload predicate', () => {
    let unsaved = true;
    render(<Guard name="A" when={false} blockUnload={() => unsaved} />);
    expect(unload()).toBe(true);
    unsaved = false;
    expect(unload()).toBe(false);
    render(<Guard name="A" blockUnload={false} />);
    expect(unload()).toBe(false);
  });

  it('release() lets every path through until the guard is re-armed', () => {
    render(<Guard name="A" />);
    guards.get('A')!.release();
    expect(guards.get('A')!.isReleased()).toBe(true);
    click(link('工单列表'));
    expect(traversal('prev', at('/orders')).defaultPrevented).toBe(false);
    expect(unload()).toBe(false);
    expect(blocked).toEqual([]);
    render(<Guard name="A" when={false} />);
    render(<Guard name="A" when />);
    expect(guards.get('A')!.isReleased()).toBe(false);
    click(link('工单列表'));
    expect(blocked).toHaveLength(1);
  });
});

describe('leaving the document after a confirmation', () => {
  it('leaveDocument() suppresses every guard’s reload prompt for that one navigation', () => {
    render(<><Guard name="A" /><Guard name="B" blockUnload={() => true} /></>);
    let promptedDuringLeave: boolean | null = null;
    leaveDocument('/orders', () => { promptedDuringLeave = unload(); });
    expect(promptedDuringLeave).toBe(false);
  });

  it('the pass ends with the task that started the navigation', async () => {
    render(<><Guard name="A" /><Guard name="B" /></>);
    leaveDocument('/orders', () => undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(unload()).toBe(true);
    click(link('工单列表'));
    expect(blocked).toHaveLength(1);
  });
});

describe('several guards at once', () => {
  it('lets the most recently mounted armed guard decide alone', () => {
    render(<><Guard name="A" /></>);
    render(<><Guard name="A" /><Guard name="B" /></>);
    click(link('工单列表'));
    traversal('prev', at('/orders'));
    expect(blocked.map((entry) => entry.guard)).toEqual(['B', 'B']);
  });

  it('falls back to an earlier guard when the latest has nothing to protect', () => {
    render(<><Guard name="A" /></>);
    render(<><Guard name="A" /><Guard name="B" shouldBlock={() => false} /></>);
    click(link('工单列表'));
    expect(blocked.map((entry) => entry.guard)).toEqual(['A']);
  });

  it('one confirmation releases the navigation for everyone (no second dialog)', () => {
    render(<><Guard name="A" /></>);
    render(<><Guard name="A" /><Guard name="B" /></>);
    click(link('工单列表'));
    blocked[0].resume();
    expect(blocked.map((entry) => entry.guard)).toEqual(['B']);
    expect(followed).toHaveBeenCalledOnce();
  });

  it('keeps the remaining guard working after another unmounts', () => {
    render(<><Guard name="A" /><Guard name="B" /></>);
    render(<><Guard name="A" /></>);
    click(link('工单列表'));
    expect(blocked.map((entry) => entry.guard)).toEqual(['A']);
  });
});
