'use client';
import Link from 'next/link';
import { Menu as BaseMenu } from '@base-ui/react/menu';

/** Dropdown menus (account, ledger switcher): Base UI behaviour with the `.menu*` styles from globals.css. */
export const MenuRoot = BaseMenu.Root;
export const MenuTrigger = BaseMenu.Trigger;

export function MenuPopup({
  children,
  align = 'end',
  className,
}: {
  children: React.ReactNode;
  align?: 'start' | 'center' | 'end';
  className?: string;
}) {
  return (
    <BaseMenu.Portal>
      <BaseMenu.Positioner className="menu-positioner" sideOffset={8} align={align}>
        <BaseMenu.Popup className={className ? `menu-popup ${className}` : 'menu-popup'}>{children}</BaseMenu.Popup>
      </BaseMenu.Positioner>
    </BaseMenu.Portal>
  );
}
export function MenuItem({
  className,
  ...props
}: Omit<React.ComponentProps<typeof BaseMenu.Item>, 'className'> & { className?: string }) {
  return <BaseMenu.Item className={className ? `menu-item ${className}` : 'menu-item'} {...props} />;
}
/** A menu entry that navigates with the Next.js router. */
export function MenuLink({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <BaseMenu.LinkItem
      className={className ? `menu-item ${className}` : 'menu-item'}
      closeOnClick
      render={<Link href={href} />}
    >
      {children}
    </BaseMenu.LinkItem>
  );
}
export function MenuSeparator() {
  return <BaseMenu.Separator className="menu-separator" />;
}
export function MenuGroupLabel({ children }: { children: React.ReactNode }) {
  return <BaseMenu.GroupLabel className="menu-label">{children}</BaseMenu.GroupLabel>;
}
export const MenuGroup = BaseMenu.Group;
