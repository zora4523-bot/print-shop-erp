import { Button } from '@/components/ui/button';
import { signOutAction } from '@/actions/account';

// Server Component on purpose: passing the server action directly as
// `form action` keeps logout working even before hydration (JS disabled,
// slow network, failed hydration). No useTransition / useFormStatus — that
// would re-introduce the client-callback dependency.
export function LogoutButton() {
  return (
    <form action={signOutAction}>
      <Button type="submit" variant="outline">
        退出登录
      </Button>
    </form>
  );
}
