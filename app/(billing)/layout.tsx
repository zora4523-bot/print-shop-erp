import AdminShellLayout from '@/app/(admin)/layout';
import OwnerLayout from '@/app/(admin)/owner/layout';

// Native financial forms must render in the initial HTML. Reuse both existing
// authorization gates and admin chrome without the admin group's streaming
// loading boundary, whose completion requires JavaScript. Public URLs stay the same.
export default function BillingLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminShellLayout>
      <OwnerLayout>{children}</OwnerLayout>
    </AdminShellLayout>
  );
}
