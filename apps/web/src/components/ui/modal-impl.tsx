'use client';
import { Dialog } from '@base-ui/react/dialog';
import { Icon } from '@/components/ui/icons';

type Focus = React.ComponentProps<typeof Dialog.Popup>['initialFocus'];

/**
 * Modal dialog (Base UI): focus trap, scroll lock, Esc to close, title wired to aria-labelledby. Head and foot stay put
 * and only `.dialogbody` scrolls. Outside clicks do not close it unless `dismissible`, so a half-filled form is never lost.
 */
export function Modal({
  open,
  onOpenChange,
  children,
  className,
  dismissible = false,
  backdrop = 'dim',
  initialFocus,
  finalFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  className?: string;
  dismissible?: boolean;
  /** `clear` keeps the page visible behind the popup (appearance preview). */
  backdrop?: 'dim' | 'clear';
  initialFocus?: Focus;
  finalFocus?: React.ComponentProps<typeof Dialog.Popup>['finalFocus'];
}) {
  return (
    <Dialog.Root open={open} onOpenChange={next => onOpenChange(next)} disablePointerDismissal={!dismissible}>
      <Dialog.Portal>
        <Dialog.Backdrop className={backdrop === 'clear' ? 'modal-backdrop clear' : 'modal-backdrop'} />
        <Dialog.Viewport
          className={['modal-viewport', ...(className?.split(' ') ?? []).map(name => `${name}-viewport`)].join(' ')}
        >
          <Dialog.Popup
            className={className ? `modal ${className}` : 'modal'}
            initialFocus={initialFocus}
            finalFocus={finalFocus}
          >
            {children}
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
/** Title row with the close button; the title names the dialog for assistive tech and tests. */
export function ModalHeader({
  title,
  description,
  children,
  closeLabel = '关闭',
}: {
  title: React.ReactNode;
  /** One line under the title, announced as the dialog's description. */
  description?: React.ReactNode;
  children?: React.ReactNode;
  closeLabel?: string;
}) {
  const heading = <Dialog.Title className="dialog-title">{title}</Dialog.Title>;
  return (
    <div className="dialoghead">
      {description ? (
        <div>
          {heading}
          <Dialog.Description className="dialog-description">{description}</Dialog.Description>
        </div>
      ) : (
        heading
      )}
      {children}
      <Dialog.Close className="icon-button" aria-label={closeLabel}>
        <Icon name="close" size={18} />
      </Dialog.Close>
    </div>
  );
}
