import * as React from "react"

const MOBILE_BREAKPOINT = 768

// shadcn 的 scaffold 默认用 useEffect + setIsMobile，这会触发 React 19
// 的 `react-hooks/set-state-in-effect` 规则（同步 setState 进 effect 引发
// 级联渲染）。改用 useSyncExternalStore —— 这就是 React 18+ 给"派生
// 外部 store 状态"开的官方口子，没有 effect、没有 setState、没有
// hydration mismatch（getServerSnapshot 显式返回 false）。
function subscribe(callback: () => void): () => void {
  const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
  mql.addEventListener("change", callback)
  return () => mql.removeEventListener("change", callback)
}

function getSnapshot(): boolean {
  return window.innerWidth < MOBILE_BREAKPOINT
}

function getServerSnapshot(): boolean {
  // 服务端没有 window；统一回落到桌面，CSR 接管后会立刻校准。
  return false
}

export function useIsMobile(): boolean {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
