import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Accessible modal built on <dialog>.showModal(): background is inert (focus stays
 * inside), Escape closes, and focus returns to the element that opened it.
 */
export default function Modal({ open, onClose, title, labelledBy = 'modal-title', children, className = '' }) {
  const ref = useRef(null);
  const returnFocus = useRef(null);

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (open && !dlg.open) {
      returnFocus.current = document.activeElement;
      if (typeof dlg.showModal === 'function') dlg.showModal();
      else dlg.setAttribute('open', '');
    } else if (!open && dlg.open) {
      if (typeof dlg.close === 'function') dlg.close();
      else dlg.removeAttribute('open');
      returnFocus.current?.focus?.();
    }
  }, [open]);

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return undefined;
    const onCancel = (e) => {
      e.preventDefault();
      onClose();
    };
    // showModal() makes the page inert, but Tab can still leave for the browser chrome;
    // keep focus cycling inside the dialog.
    const onKeyDown = (e) => {
      if (e.key !== 'Tab') return;
      const items = [...dlg.querySelectorAll(FOCUSABLE)].filter((el) => !el.disabled && el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    dlg.addEventListener('cancel', onCancel);
    dlg.addEventListener('keydown', onKeyDown);
    return () => {
      dlg.removeEventListener('cancel', onCancel);
      dlg.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      className={`modal ${className}`}
      aria-labelledby={labelledBy}
      onMouseDown={(e) => {
        if (e.target === ref.current) onClose(); // click on backdrop
      }}
    >
      {open && (
        <div className="modal__inner">
          <div className="modal__head">
            <h2 id={labelledBy}>{title}</h2>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
              <X aria-hidden="true" />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
