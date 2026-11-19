import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { IconBack } from './Icons';

export function Screen({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <main className={`mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] ${className}`}>
      {children}
    </main>
  );
}

export function TopBar({ step, total = 3, back, right }: { step?: number; total?: number; back?: string | (() => void); right?: ReactNode }) {
  const nav = useNavigate();
  const onBack = typeof back === 'function' ? back : back ? () => nav(back) : undefined;
  return (
    <header className="flex h-12 items-center justify-between gap-3">
      <div className="w-10">
        {onBack && (
          <button onClick={onBack} className="btn h-10 w-10 bg-white/70 shadow-sm" aria-label="חזרה">
            <IconBack size={20} />
          </button>
        )}
      </div>
      {step ? (
        <div className="flex flex-1 justify-center gap-1.5" aria-label={`שלב ${step} מתוך ${total}`}>
          {Array.from({ length: total }, (_, i) => (
            <span key={i} className={`h-1.5 rounded-full transition-all ${i < step ? 'w-8 bg-tomato' : 'w-4 bg-charcoal/15'}`} />
          ))}
        </div>
      ) : (
        <div className="flex-1" />
      )}
      <div className="flex w-10 justify-end">{right}</div>
    </header>
  );
}
