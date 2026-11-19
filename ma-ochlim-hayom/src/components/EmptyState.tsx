import type { ReactNode } from 'react';

export function EmptyState({ emoji, title, text, children }: { emoji: string; title: string; text?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center py-10 text-center anim-rise" role="status">
      <div className="mb-4 text-7xl anim-wiggle" aria-hidden>{emoji}</div>
      <h2 className="text-2xl font-bold">{title}</h2>
      {text && <p className="mt-2 max-w-xs text-ink-soft">{text}</p>}
      {children && <div className="mt-6 flex w-full max-w-xs flex-col gap-3">{children}</div>}
    </div>
  );
}
