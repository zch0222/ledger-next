'use client';
import { initials } from '@ledger/ui/format';
import { useSignOut } from '@/lib/use-sign-out';
import { Icon } from '@/components/ui/icons';
import { lazyControl } from '@/components/ui/lazy';

export type AccountMenuProps = { name: string; email: string; ledgerId: string };

/**
 * Top-bar avatar: opens the account menu; signing out is an explicit item, never the avatar click itself.
 * The menu (account-menu-popup.tsx) loads after hydration; until then the avatar is static and inert.
 */
export const AccountMenu = lazyControl<AccountMenuProps>(
  () => import('@/components/account-menu-popup').then(m => m.AccountMenuPopup),
  ({ name }) => (
    <button type="button" className="avatar" aria-disabled="true" tabIndex={-1} title={name}>
      {initials(name)}
    </button>
  ),
);

/** Plain sign-out button for pages without the top bar (onboarding, settings, mobile "更多"). */
export function SignOutButton() {
  const { signOut, error } = useSignOut();
  return (
    <>
      <button onClick={() => void signOut()}>
        <Icon name="logOut" size={18} />
        退出当前账号
      </button>
      {error && (
        <span role="alert" className="error">
          {error}
        </span>
      )}
    </>
  );
}
