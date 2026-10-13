import React from 'react';
import { cn } from '@/lib/utils';

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'urgent' | 'high' | 'medium' | 'low' | 'success' | 'indigo';
}

export function Badge({ className, variant = 'default', children, ...props }: BadgeProps) {
  const variants = {
    default: 'bg-slate-800 text-slate-300 border-slate-700',
    urgent: 'bg-rose-950/80 text-rose-300 border-rose-800/60',
    high: 'bg-amber-950/80 text-amber-300 border-amber-800/60',
    medium: 'bg-sky-950/80 text-sky-300 border-sky-800/60',
    low: 'bg-emerald-950/80 text-emerald-300 border-emerald-800/60',
    success: 'bg-emerald-900/60 text-emerald-300 border-emerald-700/50',
    indigo: 'bg-indigo-950/80 text-indigo-300 border-indigo-800/60',
  };
  return (
    <div className={cn('inline-flex items-center rounded-lg border px-2.5 py-0.5 text-xs font-semibold tracking-wide transition-colors', variants[variant], className)} {...props}>
      {children}
    </div>
  );
}
