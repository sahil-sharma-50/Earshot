import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Info } from 'lucide-react';

/** An ⓘ button that toggles a short explanation. Click or keyboard, never hover-only. */
export function Toggletip({ label, children, align = 'start' }: { label: string; children: ReactNode; align?: 'start' | 'end' }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <span className="tip" ref={root}>
      <button type="button" className="tip-btn" aria-label={label} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <Info size={15} aria-hidden />
      </button>
      <span id={id} role="status" className={`tip-pop tip-${align}`} hidden={!open}>{open && children}</span>
    </span>
  );
}
