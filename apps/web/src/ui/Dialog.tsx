import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

/** Native modal dialog. Esc closes unless `dismissible` is false; the browser returns focus to the opener. */
export function Dialog({ open, title, onClose, children, actions, variant = 'modal', dismissible = true, icon, describedBy }: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
  variant?: 'modal' | 'drawer' | 'lightbox';
  dismissible?: boolean;
  icon?: ReactNode;
  describedBy?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`dlg dlg-${variant}`}
      aria-labelledby={titleId}
      aria-describedby={describedBy}
      onCancel={(e) => { e.preventDefault(); if (dismissible) onClose(); }}
      onClick={(e) => { if (dismissible && e.target === ref.current) onClose(); }}
    >
      <div className="dlg-inner">
        <header className="dlg-head">
          <h2 id={titleId}>{icon}{title}</h2>
          {dismissible && <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} aria-hidden /></button>}
        </header>
        <div className="dlg-body">{children}</div>
        {actions && <footer className="dlg-actions">{actions}</footer>}
      </div>
    </dialog>
  );
}
