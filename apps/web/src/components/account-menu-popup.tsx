'use client';
import { initials } from '@ledger/ui/format';
import { useSignOut } from '@/lib/use-sign-out';
import { Icon } from '@/components/ui/icons';
import { MenuItem, MenuLink, MenuPopup, MenuRoot, MenuSeparator, MenuTrigger } from '@/components/ui/menu';
import type { AccountMenuProps } from '@/components/account-menu';

/** Base UI menu behind the top-bar avatar (account-menu.tsx loads it after hydration). */
export function AccountMenuPopup({ name, email, ledgerId }: AccountMenuProps) {
  const { signOut, error } = useSignOut();
  return (
    <>
      <MenuRoot>
        <MenuTrigger className="avatar" aria-label={`账号：${name}`} title={name}>
          {initials(name)}
        </MenuTrigger>
        <MenuPopup className="account-menu">
          <div className="menu-header">
            <strong>{name}</strong>
            <span>{email}</span>
          </div>
          <MenuSeparator />
          <MenuLink href={`/ledgers/${ledgerId}/settings`}>
            <Icon name="settings" size={18} />
            账本设置
          </MenuLink>
          <MenuLink href={`/ledgers/${ledgerId}/settings/appearance`}>
            <Icon name="contrast" size={18} />
            外观
          </MenuLink>
          <MenuSeparator />
          <MenuItem className="danger-item" onClick={() => void signOut()}>
            <Icon name="logOut" size={18} />
            退出登录
          </MenuItem>
        </MenuPopup>
      </MenuRoot>
      {error && (
        <span role="alert" className="error">
          {error}
        </span>
      )}
    </>
  );
}
