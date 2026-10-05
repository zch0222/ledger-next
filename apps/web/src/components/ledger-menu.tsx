'use client';
import { Icon } from '@/components/ui/icons';
import {
  MenuGroup,
  MenuGroupLabel,
  MenuLink,
  MenuPopup,
  MenuRoot,
  MenuSeparator,
  MenuTrigger,
} from '@/components/ui/menu';
import type { LedgerSelectProps } from '@/components/ledger-select';

/** Base UI menu behind the ledger switcher (ledger-select.tsx loads it after hydration). */
export function LedgerMenu({ ledgers, current }: LedgerSelectProps) {
  const name = ledgers.find(l => l.id === current)?.name ?? '账本';
  return (
    <MenuRoot>
      <MenuTrigger className="ledger-switch" aria-label={`切换账本：${name}`}>
        <span className="ledger-switch-name">{name}</span>
        <Icon name="chevronDown" size={16} />
      </MenuTrigger>
      <MenuPopup align="start" className="ledger-menu">
        <MenuGroup>
          <MenuGroupLabel>我的账本</MenuGroupLabel>
          {ledgers.map(l => (
            <MenuLink
              key={l.id}
              href={`/ledgers/${l.id}/dashboard`}
              className={l.id === current ? 'current' : undefined}
            >
              <Icon name="book" size={18} />
              <span className="menu-text">{l.name}</span>
              {l.id === current && <Icon name="check" size={16} className="ui-icon menu-check" />}
            </MenuLink>
          ))}
        </MenuGroup>
        <MenuSeparator />
        <MenuLink href={`/ledgers/${current}/settings`}>
          <Icon name="settings" size={18} />
          账本设置
        </MenuLink>
        <MenuLink href="/onboarding">
          <Icon name="plus" size={18} />
          新建账本
        </MenuLink>
      </MenuPopup>
    </MenuRoot>
  );
}
