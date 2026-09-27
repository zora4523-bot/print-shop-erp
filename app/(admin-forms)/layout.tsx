import AdminShellLayout from '@/app/(admin)/layout';
import OwnerLayout from '@/app/(admin)/owner/layout';

/** Native form pages share authorization and chrome, without an inherited
 * loading.tsx whose streamed replacement requires JavaScript to reveal them.
 * The root layout remains shared; public route URLs are unchanged. */
export default function AdminFormsLayout({ children }: { children: React.ReactNode }) {
  return <AdminShellLayout><OwnerLayout>{children}</OwnerLayout></AdminShellLayout>;
}
