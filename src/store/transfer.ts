import { create } from 'zustand';

export interface TransferTask {
  id: string;
  type: 'upload' | 'download';
  fileName: string;
  filePath?: string;
  url?: string;
  totalSize: number;
  transferredSize: number;
  progress: number;
  status: 'pending' | 'transferring' | 'completed' | 'failed' | 'cancelled';
  error?: string;
  startTime: number;
  endTime?: number;
  speed?: number; // bytes per second
}

interface TransferStore {
  tasksById: Record<string, TransferTask>;
  taskIds: string[];
  isPanelOpen: boolean;

  addTask: (task: Omit<TransferTask, 'id' | 'startTime' | 'status' | 'progress' | 'transferredSize'>) => string;
  updateTask: (id: string, updates: Partial<TransferTask>) => void;
  /** 合并多次进度更新，只触发一次 set */
  batchUpdateTasks: (updates: Map<string, Partial<TransferTask>>) => void;
  removeTask: (id: string) => void;
  clearCompleted: () => void;
  clearAll: () => void;
  togglePanel: () => void;
  setPanelOpen: (open: boolean) => void;
}

export const useTransferStore = create<TransferStore>((set) => ({
  tasksById: {},
  taskIds: [],
  isPanelOpen: false,

  addTask: (task) => {
    const id = crypto.randomUUID();
    const newTask: TransferTask = {
      ...task,
      id,
      startTime: Date.now(),
      status: 'pending',
      progress: 0,
      transferredSize: 0,
    };
    set((state) => ({
      tasksById: { ...state.tasksById, [id]: newTask },
      taskIds: [...state.taskIds, id],
    }));
    return id;
  },

  updateTask: (id, updates) => {
    set((state) => {
      const prev = state.tasksById[id];
      if (!prev) return state;
      return {
        tasksById: { ...state.tasksById, [id]: { ...prev, ...updates } },
      };
    });
  },

  batchUpdateTasks: (updates) => {
    if (updates.size === 0) return;
    set((state) => {
      let changed = false;
      const next = { ...state.tasksById };
      for (const [id, patch] of updates) {
        const prev = next[id];
        if (!prev) continue;
        next[id] = { ...prev, ...patch };
        changed = true;
      }
      return changed ? { tasksById: next } : state;
    });
  },

  removeTask: (id) => {
    set((state) => {
      const { [id]: _, ...rest } = state.tasksById;
      return {
        tasksById: rest,
        taskIds: state.taskIds.filter((tid) => tid !== id),
      };
    });
  },

  clearCompleted: () => {
    set((state) => {
      const taskIds: string[] = [];
      const tasksById: Record<string, TransferTask> = {};
      for (const id of state.taskIds) {
        const t = state.tasksById[id];
        if (!t || t.status === 'completed') continue;
        taskIds.push(id);
        tasksById[id] = t;
      }
      return { taskIds, tasksById };
    });
  },

  clearAll: () => {
    set({ tasksById: {}, taskIds: [] });
  },

  togglePanel: () => {
    set((state) => ({ isPanelOpen: !state.isPanelOpen }));
  },

  setPanelOpen: (open) => {
    set({ isPanelOpen: open });
  },
}));
