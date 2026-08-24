import { EmptyState } from '@/components/ui-business';

export default function RootNotFound() {
  return (
    <main className="flex min-h-svh items-center justify-center p-4 sm:p-6">
      <EmptyState
        kind="no-access"
        homeHref="/"
        className="w-full max-w-lg bg-card"
      />
    </main>
  );
}
