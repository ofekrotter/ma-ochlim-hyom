import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal focus handling: focus moves into the dialog ([data-autofocus] first),
 * Tab stays inside, Escape closes, and focus returns to where it was.
 */
export function useDialogFocus(ref: RefObject<HTMLElement | null>, onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = ref.current;
    const first = root?.querySelector<HTMLElement>('[data-autofocus]') ?? root?.querySelector<HTMLElement>(FOCUSABLE) ?? root;
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close.current();
        return;
      }
      if (e.key !== 'Tab' || !ref.current) return;
      const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const a = items[0];
      const z = items[items.length - 1];
      if (e.shiftKey && document.activeElement === a) {
        e.preventDefault();
        z.focus();
      } else if (!e.shiftKey && document.activeElement === z) {
        e.preventDefault();
        a.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      if (before && document.contains(before)) before.focus();
    };
  }, [ref]);
}

export interface ConfirmOptions {
  title: string;
  text?: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** The confirm action discards something (red button). */
  danger?: boolean;
}

export function ConfirmDialog({ title, text, confirmLabel, cancelLabel = 'ביטול', danger = false, onConfirm, onCancel }: ConfirmOptions & { onConfirm: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref, onCancel);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-charcoal/60 p-4 sm:items-center" onClick={onCancel}>
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby={text ? 'confirm-text' : undefined}
        tabIndex={-1}
        className="w-full max-w-sm rounded-[2rem] bg-cream p-5 shadow-xl anim-rise"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-title" className="text-xl font-extrabold">{title}</h2>
        {text && <p id="confirm-text" className="mt-2 text-ink-soft">{text}</p>}
        <div className="mt-5 flex flex-col gap-3">
          <button type="button" className="btn-primary" data-danger={danger || undefined} onClick={onConfirm}>
            {confirmLabel}
          </button>
          <button type="button" className="btn-secondary" data-autofocus onClick={onCancel}>
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** `const [dialog, ask] = useConfirm()` — render `dialog`, then `if (await ask({...}))`. */
export function useConfirm(): [ReactNode, (o: ConfirmOptions) => Promise<boolean>] {
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);
  const ask = useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ ...o, resolve })), []);
  const done = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };
  const node = pending ? <ConfirmDialog {...pending} onConfirm={() => done(true)} onCancel={() => done(false)} /> : null;
  return [node, ask];
}
