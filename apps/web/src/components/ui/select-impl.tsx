'use client';
import { Select as BaseSelect } from '@base-ui/react/select';
import { Icon } from '@/components/ui/icons';
import type { SelectProps } from '@/components/ui/select';

/** Base UI listbox behind `Select` (select.tsx loads it after hydration); styled by `.select*` in globals.css. */
export function Select({
  options,
  id,
  name,
  value,
  defaultValue,
  onValueChange,
  disabled,
  required,
  placeholder,
  className,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
}: SelectProps) {
  return (
    <BaseSelect.Root
      items={options}
      name={name}
      value={value}
      defaultValue={defaultValue}
      onValueChange={next => onValueChange?.((next as string | null) ?? '')}
      disabled={disabled}
      required={required}
    >
      <BaseSelect.Trigger
        id={id}
        className={className ? `select ${className}` : 'select'}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
      >
        <BaseSelect.Value className="select-value" placeholder={placeholder} />
        <BaseSelect.Icon className="select-icon">
          <Icon name="chevronDown" size={16} />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner className="select-positioner" sideOffset={6} alignItemWithTrigger={false}>
          <BaseSelect.Popup className="select-popup">
            <BaseSelect.List className="select-list">
              {options.map(o => (
                <BaseSelect.Item
                  key={o.value}
                  value={o.value}
                  label={o.label}
                  disabled={o.disabled}
                  className="select-item"
                >
                  <BaseSelect.ItemText>{o.label}</BaseSelect.ItemText>
                  <BaseSelect.ItemIndicator className="select-check">
                    <Icon name="check" size={16} />
                  </BaseSelect.ItemIndicator>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
