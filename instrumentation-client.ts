import { noteRouterTransitionStart } from './components/ui-business/navigation-guard-transition';

/**
 * Next.js public hook: called synchronously when an App Router navigation
 * starts. The shared navigation guard uses it to tell "Next Link took over the
 * confirmed click" from "a consumer cancelled it" (see navigation-guard.ts).
 */
export function onRouterTransitionStart(url: string): void {
  noteRouterTransitionStart(url);
}
