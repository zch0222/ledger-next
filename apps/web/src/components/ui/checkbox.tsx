'use client';
import { Checkbox as BaseCheckbox } from '@base-ui/react/checkbox';
import { Icon } from '@/components/ui/icons';

/** Labelled checkbox (Base UI): the enclosing label names it, and `name` submits "on" with the form like a native one. */
export function Checkbox({
  children,
  checked,
  defaultChecked,
  onCheckedChange,
  name,
  disabled,
  className = 'check',
}: {
  children: React.ReactNode;
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  name?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <label className={className}>
      <BaseCheckbox.Root
        className="checkbox"
        checked={checked}
        defaultChecked={defaultChecked}
        onCheckedChange={next => onCheckedChange?.(next)}
        name={name}
        disabled={disabled}
      >
        <BaseCheckbox.Indicator className="checkbox-indicator">
          <Icon name="check" size={14} strokeWidth={2.5} />
        </BaseCheckbox.Indicator>
      </BaseCheckbox.Root>
      <span>{children}</span>
    </label>
  );
}
