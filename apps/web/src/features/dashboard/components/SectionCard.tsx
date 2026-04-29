import type { ReactNode } from 'react';
import { cn } from '../../../lib/utils';

interface SectionCardProps {
  title: string;
  rightSlot?: ReactNode;
  description?: string;
  children: ReactNode;
  className?: string;
}

export function SectionCard({ title, description, rightSlot, children, className }: SectionCardProps) {
  return (
    <section
      className={cn(
        'rounded-2xl border border-white/60 bg-white/80 shadow-[0_8px_30px_-12px_rgba(180,83,9,0.12)] backdrop-blur-sm',
        className,
      )}
    >
      <header className="flex items-center justify-between gap-4 border-b border-stone-200/60 px-6 py-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {rightSlot && <div className="shrink-0">{rightSlot}</div>}
      </header>
      <div className="p-6">{children}</div>
    </section>
  );
}
