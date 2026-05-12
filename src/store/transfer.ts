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
  tasks: TransferTask[];
  isPanelOpen: boolean;
  
  addTask: (task: Omit<TransferTask, 'id' | 'startTime' | 'status' | 'progress' | 'transferredSize'>) => string;
  updateTask: (id: string, updates: Partial<TransferTask>) => void;
  removeTask: (id: string) => void;
  clearCompleted: () => void;
  clearAll: () => void;
  togglePanel: () => void;
  setPanelOpen: (open: boolean) => void;
}

export const useTransferStore = create<TransferStore>((set) => ({
  tasks: [],
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
    set((state) => ({ tasks: [...state.tasks, newTask] }));
    return id;
  },
  
  updateTask: (id, updates) => {
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === id ? { ...task, ...updates } : task
      ),
    }));
  },
  
  removeTask: (id) => {
    set((state) => ({
      tasks: state.tasks.filter((task) => task.id !== id),
    }));
  },
  
  clearCompleted: () => {
    set((state) => ({
      tasks: state.tasks.filter((task) => task.status !== 'completed'),
    }));
  },
  
  clearAll: () => {
    set({ tasks: [] });
  },
  
  togglePanel: () => {
    set((state) => ({ isPanelOpen: !state.isPanelOpen }));
  },
  
  setPanelOpen: (open) => {
    set({ isPanelOpen: open });
  },
}));
