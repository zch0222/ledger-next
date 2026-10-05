'use client';
import { Icon } from '@/components/ui/icons';
import { lazyControl } from '@/components/ui/lazy';

export type SelectOption = { value: string; label: string; disabled?: boolean };
/** Options whose label is the value itself, e.g. currency codes. */
export const plainOptions = (values: readonly string[]): SelectOption[] => values.map(v => ({ value: v, label: v }));
/** Options from a `{ value: label }` map, in insertion order. */
export const labelOptions = (labels: Record<string, string>): SelectOption[] =>
  Object.entries(labels).map(([value, label]) => ({ value, label }));
type ValueProps =
  | { value: string; onValueChange: (value: string) => void; defaultValue?: undefined }
  | { value?: undefined; defaultValue?: string; onValueChange?: (value: string) => void };
export type SelectProps = ValueProps & {
  options: readonly SelectOption[];
  /** Goes on the trigger, so an outer `<label htmlFor>` names it. */
  id?: string;
  /** Submitted through Base UI's hidden input, so `new FormData(form)` keeps working. */
  name?: string;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  className?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
};

/** The closed select as static markup, shown until the Base UI listbox has loaded. */
function SelectFallback({ options, id, name, value, defaultValue, placeholder, className, ...aria }: SelectProps) {
  const current = value ?? defaultValue;
  const label = options.find(o => o.value === current)?.label ?? placeholder ?? '';
  return (
    <>
      <button
        type="button"
        id={id}
        className={className ? `select ${className}` : 'select'}
        aria-label={aria['aria-label']}
        aria-describedby={aria['aria-describedby']}
        aria-disabled="true"
        tabIndex={-1}
      >
        <span className="select-value">{label}</span>
        <span className="select-icon">
          <Icon name="chevronDown" size={16} />
        </span>
      </button>
      {name && <input type="hidden" name={name} value={current ?? ''} />}
    </>
  );
}

/** The app's only select (Base UI listbox); every visual rule is `.select*` in globals.css. */
export const Select = lazyControl<SelectProps>(
  () => import('@/components/ui/select-impl').then(m => m.Select),
  SelectFallback,
);
