'use client';

import React from 'react';
import { TaskResponse } from '@/types';
import { Badge } from '@/components/ui/badge';
import { CheckSquare, Sparkles, User as UserIcon, ListChecks } from 'lucide-react';

interface TaskCardProps {
  task: TaskResponse;
  onOpenBreakdown?: (task: TaskResponse) => void;
  onOpenChecklist?: (task: TaskResponse) => void;
}

export function TaskCard({ task, onOpenBreakdown, onOpenChecklist }: TaskCardProps) {
  const getPriorityVariant = (priority: string) => {
    switch (priority) {
      case 'URGENT': return 'urgent';
      case 'HIGH': return 'high';
      case 'MEDIUM': return 'medium';
      default: return 'low';
    }
  };

  const checklistCount = task.checklist ? task.checklist.length : 0;
  const completedChecklistCount = task.checklist ? task.checklist.filter((item) => item.done).length : 0;

  return (
    <div className="glass-card rounded-xl p-4 space-y-3 relative group">
      <div className="flex items-center justify-between">
        <Badge variant={getPriorityVariant(task.priority)}>{task.priority}</Badge>
        {task.requiredLevel && (
          <span className="text-[10px] font-bold text-indigo-400 bg-indigo-950/80 px-2 py-0.5 rounded-md border border-indigo-800/40 uppercase">{task.requiredLevel}</span>
        )}
      </div>

      <div>
        <h4 className="font-semibold text-slate-100 text-sm group-hover:text-indigo-300 transition-colors">{task.title}</h4>
        {task.description && <p className="text-xs text-slate-400 line-clamp-2 mt-1 leading-relaxed">{task.description}</p>}
      </div>

      {checklistCount > 0 && (
        <div className="flex items-center space-x-2 text-xs text-slate-400 bg-slate-950/50 px-2.5 py-1 rounded-lg border border-slate-800">
          <CheckSquare className="h-3.5 w-3.5 text-indigo-400" />
          <span>{completedChecklistCount}/{checklistCount} steps completed</span>
        </div>
      )}

      <div className="flex items-center justify-between pt-2 border-t border-slate-800/60">
        <div className="flex items-center space-x-2">
          <div className="h-6 w-6 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-[10px] font-bold text-slate-300">
            {task.assignee ? task.assignee.fullName.charAt(0) : <UserIcon className="h-3 w-3" />}
          </div>
          <span className="text-xs text-slate-400 truncate max-w-[90px]">
            {task.assignee ? task.assignee.fullName : 'Unassigned'}
          </span>
        </div>

        <div className="flex items-center space-x-1">
          {onOpenChecklist && (
            <button onClick={() => onOpenChecklist(task)} title="Generate Adaptive Steps" className="p-1 rounded-lg text-slate-400 hover:text-indigo-300 hover:bg-indigo-950/50 transition-colors">
              <ListChecks className="h-3.5 w-3.5" />
            </button>
          )}
          {onOpenBreakdown && (
            <button onClick={() => onOpenBreakdown(task)} title="AI Task Breakdown" className="p-1 rounded-lg text-slate-400 hover:text-purple-300 hover:bg-purple-950/50 transition-colors">
              <Sparkles className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
