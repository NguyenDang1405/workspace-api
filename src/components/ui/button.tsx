import React from 'react';
import { cn } from '@/lib/utils';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', children, ...props }, ref) => {
    const base = 'inline-flex items-center justify-center font-medium rounded-xl transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]';
    const variants = {
      primary: 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/25 hover:shadow-indigo-600/40 border border-indigo-400/20',
      secondary: 'bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700/60',
      outline: 'bg-transparent border border-slate-700 hover:border-indigo-500 hover:bg-indigo-500/10 text-slate-200',
      ghost: 'bg-transparent hover:bg-slate-800/60 text-slate-400 hover:text-slate-100',
      danger: 'bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/20 border border-rose-400/20',
    };
    const sizes = { sm: 'px-3 py-1.5 text-xs gap-1.5', md: 'px-4 py-2.5 text-sm gap-2', lg: 'px-6 py-3 text-base gap-2.5' };
    return (
      <button ref={ref} className={cn(base, variants[variant], sizes[size], className)} {...props}>
        {children}
      </button>
    );
  }
);
Button.displayName = 'Button';
