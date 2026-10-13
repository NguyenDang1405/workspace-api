'use client';

import React from 'react';
import { TaskResponse, TaskStatus } from '@/types';
import { TaskCard } from './task-card';
import { Plus } from 'lucide-react';

interface KanbanColumnProps {
  title: string;
  status: TaskStatus;
  tasks: TaskResponse[];
  color: string;
  onAddTask?: (status: TaskStatus) => void;
  onOpenBreakdown?: (task: TaskResponse) => void;
  onOpenChecklist?: (task: TaskResponse) => void;
}

export function KanbanColumn({ title, status, tasks, color, onAddTask, onOpenBreakdown, onOpenChecklist }: KanbanColumnProps) {
  return (
    <div className="flex flex-col rounded-2xl border border-slate-800/80 bg-slate-950/40 p-4 h-[calc(100vh-12rem)] min-w-[300px] flex-1">
      <div className="flex items-center justify-between pb-3 border-b border-slate-800/80 mb-4">
        <div className="flex items-center space-x-2.5">
          <span className={`h-3 w-3 rounded-full ${color}`} />
          <h3 className="font-bold text-sm text-slate-200 tracking-wide">{title}</h3>
          <span className="rounded-md bg-slate-900 border border-slate-800 px-2 py-0.5 text-xs font-semibold text-slate-400">{tasks.length}</span>
        </div>
        {onAddTask && (
          <button onClick={() => onAddTask(status)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100 transition-colors">
            <Plus className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto space-y-3 pr-1">
        {tasks.length === 0 ? (
          <div className="flex h-32 items-center justify-center rounded-xl border border-dashed border-slate-800/80 text-xs text-slate-600">
            No tasks in {title.toLowerCase()}
          </div>
        ) : (
          tasks.map((task) => (
            <TaskCard key={task.id} task={task} onOpenBreakdown={onOpenBreakdown} onOpenChecklist={onOpenChecklist} />
          ))
        )}
      </div>
    </div>
  );
}
