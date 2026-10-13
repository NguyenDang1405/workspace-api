'use client';

import React from 'react';
import { Search, Bell, Sparkles } from 'lucide-react';
import { Input } from '@/components/ui/input';

export function Navbar() {
  return (
    <header className="sticky top-0 z-30 h-16 border-b border-slate-800/80 bg-slate-950/60 backdrop-blur-xl flex items-center justify-between px-6">
      <div className="relative w-80">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
        <Input placeholder="RAG Vector search skills, members..." className="pl-9 bg-slate-900/80 border-slate-800 focus:ring-indigo-500/30" />
      </div>

      <div className="flex items-center space-x-4">
        <button className="relative rounded-xl border border-slate-800 bg-slate-900/60 p-2 text-slate-400 hover:text-slate-100 hover:border-slate-700 transition-colors">
          <Bell className="h-4 w-4" />
          <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-indigo-500"></span>
          </span>
        </button>

        <div className="flex items-center space-x-3 border-l border-slate-800 pl-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white font-bold text-sm shadow-md shadow-indigo-600/30">AM</div>
          <div className="hidden md:block text-left">
            <div className="flex items-center space-x-1.5">
              <span className="text-sm font-semibold text-slate-100">Alex Morgan</span>
              <Sparkles className="h-3 w-3 text-amber-400" />
            </div>
            <span className="text-xs text-slate-400">Senior Fullstack Tech Lead</span>
          </div>
        </div>
      </div>
    </header>
  );
}
