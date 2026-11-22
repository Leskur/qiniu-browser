import { create } from 'zustand';

export interface TransferTask {
  id: string;
  type: 'upload' | 'download';
  fileName: string;
  filePath?: string;
  url?: string;
  retry?: () => Promise<void>;
  totalSize: number;
  transferredSize: number;
  progress: number;
  status: 'pending' | 'transferring' | 'completed' | 'failed' | 'cancelled' | 'skipped';
  error?: string;
  startTime: number;
  endTime?: number;
  speed?: number; // bytes per second
}

type NewTask = Omit<TransferTask, 'id' | 'startTime' | 'status' | 'progress' | 'transferredSize'>;

interface TransferStore {
  tasksById: Record<string, TransferTask>;
  taskIds: string[];
  isPanelOpen: boolean;

  addTask: (task: NewTask) => string;
  addTasks: (tasks: NewTask[]) => string[];
  updateTask: (id: string, updates: Partial<TransferTask>) => void;
  /** 合并多次进度更新，只触发一次 set */
  batchUpdateTasks: (updates: Map<string, Partial<TransferTask>>) => void;
  /** 将进行中的上传标记为已取消 */
  cancelActiveUploads: () => void;
  removeTask: (id: string) => void;
  clearCompleted: () => void;
  /** 清除已结束任务（完成/失败/取消），保留进行中 */
  clearInactive: () => void;
  clearAll: () => void;
  togglePanel: () => void;
  setPanelOpen: (open: boolean) => void;
}

export const useTransferStore = create<TransferStore>((set, get) => ({
  tasksById: {},
  taskIds: [],
  isPanelOpen: false,

  addTask: (task) => get().addTasks([task])[0],

  addTasks: (tasks) => {
    const startTime = Date.now();
    const newTasks = tasks.map((task): TransferTask => ({
      ...task,
      id: crypto.randomUUID(),
      startTime,
      status: 'pending',
      progress: 0,
      transferredSize: 0,
    }));
    const ids = newTasks.map((task) => task.id);
    set((state) => ({
      tasksById: { ...state.tasksById, ...Object.fromEntries(newTasks.map((task) => [task.id, task])) },
      taskIds: [...state.taskIds, ...ids],
    }));
    return ids;
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
        // 已取消的任务：忽略迟到的进度，只接受 completed（实际上传已完成）
        if (prev.status === 'cancelled') {
          if (patch.status === 'completed') {
            next[id] = { ...prev, ...patch };
            changed = true;
          }
          continue;
        }
        next[id] = { ...prev, ...patch };
        changed = true;
      }
      return changed ? { tasksById: next } : state;
    });
  },

  cancelActiveUploads: () => {
    set((state) => {
      let changed = false;
      const next = { ...state.tasksById };
      const now = Date.now();
      for (const id of state.taskIds) {
        const t = next[id];
        if (!t || t.type !== 'upload') continue;
        if (t.status !== 'pending' && t.status !== 'transferring') continue;
        next[id] = { ...t, status: 'cancelled', endTime: now, error: '已停止' };
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

  clearInactive: () => {
    set((state) => {
      const taskIds: string[] = [];
      const tasksById: Record<string, TransferTask> = {};
      for (const id of state.taskIds) {
        const t = state.tasksById[id];
        if (!t) continue;
        if (t.status === 'pending' || t.status === 'transferring') {
          taskIds.push(id);
          tasksById[id] = t;
        }
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
