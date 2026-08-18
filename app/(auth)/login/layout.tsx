// 登录页外壳。
//
// 两点不是样式偏好，是可访问性要求：
//   - <main>：这条路由不在 (admin)/(worker) 壳里，没有别处的 SidebarInset
//     / <main> 兜底，缺了它整页没有任何地标。
//   - .touch-viewport：44px 触控目标兜底同样只挂在那两个壳上，登录页拿不到，
//     控件会停在 h-8（32px）。师傅在车间用手机登录是真实场景。
export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="touch-viewport min-h-screen flex items-center justify-center bg-muted/40 p-4">
      {children}
    </main>
  );
}
