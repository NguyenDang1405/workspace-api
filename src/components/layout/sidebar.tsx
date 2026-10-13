'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Kanban, Users, FolderKanban, User, Sparkles, Bot, BrainCircuit, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { label: 'Projects', href: '/projects', icon: FolderKanban },
  { label: 'Kanban Board', href: '/projects/demo-project-id/kanban', icon: Kanban },
  { label: 'Teams', href: '/teams', icon: Users },
  { label: 'Profile', href: '/profile', icon: User },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 z-40 h-screen w-64 border-r border-slate-800/80 bg-slate-950/80 backdrop-blur-2xl flex flex-col justify-between p-4">
      <div className="space-y-6">
        <div className="flex items-center space-x-3 px-2 py-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-600 to-purple-600 text-white shadow-lg shadow-indigo-500/30">
            <BrainCircuit className="h-6 w-6" />
          </div>
          <div>
            <h1 className="font-extrabold tracking-tight text-lg text-slate-100 leading-tight">
              Smart<span className="text-indigo-400">Workspace</span>
            </h1>
            <span className="inline-flex items-center text-[10px] font-semibold text-indigo-400 bg-indigo-950/80 px-2 py-0.5 rounded-full border border-indigo-800/50">
              <Sparkles className="h-2.5 w-2.5 mr-1" /> AI Powered
            </span>
          </div>
        </div>

        <nav className="space-y-1">
          <p className="px-3 text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">Navigation</p>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href || (item.href !== '/projects' && pathname.startsWith(item.href));
            return (
              <Link key={item.href} href={item.href}
                className={cn('flex items-center space-x-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200',
                  isActive ? 'bg-indigo-600/15 text-indigo-300 border border-indigo-500/30 shadow-inner' : 'text-slate-400 hover:bg-slate-900 hover:text-slate-100')}>
                <Icon className={cn('h-4 w-4', isActive ? 'text-indigo-400' : 'text-slate-400')} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="rounded-xl border border-purple-500/20 bg-purple-950/20 p-3.5 space-y-2">
          <div className="flex items-center space-x-2 text-purple-300 font-semibold text-xs">
            <Bot className="h-4 w-4 text-purple-400" />
            <span>AI Copilot Active</span>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Automatic team matching (pgvector) and adaptive task breakdowns enabled.
          </p>
        </div>
      </div>

      <div className="pt-4 border-t border-slate-800/80">
        <Link href="/login" className="flex items-center space-x-3 w-full rounded-xl px-3 py-2.5 text-sm font-medium text-slate-400 hover:bg-rose-950/40 hover:text-rose-300 transition-colors">
          <LogOut className="h-4 w-4" />
          <span>Sign Out</span>
        </Link>
      </div>
    </aside>
  );
}
