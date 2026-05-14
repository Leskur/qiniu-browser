import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { QiniuBucket } from '../lib/qiniu'

export type Theme = 'light' | 'dark' | 'system';

interface AppState {
  buckets: QiniuBucket[];
  setBuckets: (buckets: QiniuBucket[]) => void;
  // 计算属性
  getTotalStats: () => { totalBuckets: number; totalFiles: number; totalSize: number };
  
  // 外观设置
  theme: Theme;
  setTheme: (theme: Theme) => void;
  
  // 文件管理设置
  itemsPerPage: 20 | 50 | 100 | 200;
  setItemsPerPage: (count: 20 | 50 | 100 | 200) => void;
  
  // 缓存设置
  cacheExpireMinutes: number;
  setCacheExpireMinutes: (minutes: number) => void;
  
  // 通知设置
  notifyOnComplete: boolean;
  setNotifyOnComplete: (notify: boolean) => void;
}

/**
 * 将 theme 应用到 <html> 元素
 */
function applyThemeToDOM(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
  } else if (theme === 'light') {
    root.classList.remove('dark');
  } else {
    // system
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (prefersDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      buckets: [],
      setBuckets: (buckets) => set({ buckets }),
      getTotalStats: () => {
        const buckets = get().buckets;
        let totalFiles = 0;
        let totalSize = 0;

        buckets.forEach(b => {
          if (b.file_num > 0) totalFiles += b.file_num;
          if (b.storage_size > 0) totalSize += b.storage_size;
        });

        return {
          totalBuckets: buckets.length,
          totalFiles,
          totalSize
        };
      },
      
      // 外观设置
      theme: 'system',
      setTheme: (theme) => {
        set({ theme });
        applyThemeToDOM(theme);
      },
      
      // 文件管理设置
      itemsPerPage: 50,
      setItemsPerPage: (count) => set({ itemsPerPage: count }),
      
      // 缓存设置
      cacheExpireMinutes: 5,
      setCacheExpireMinutes: (minutes) => set({ cacheExpireMinutes: minutes }),
      
      // 通知设置
      notifyOnComplete: true,
      setNotifyOnComplete: (notify) => set({ notifyOnComplete: notify }),
    }),
    {
      name: 'qiniu-browser-settings',
      // 持久化所有设置（除了 buckets 运行时数据）
      partialize: (state) => ({
        theme: state.theme,
        itemsPerPage: state.itemsPerPage,
        cacheExpireMinutes: state.cacheExpireMinutes,
        notifyOnComplete: state.notifyOnComplete,
      }),
      onRehydrateStorage: () => {
        return (state) => {
          if (state) {
            applyThemeToDOM(state.theme);
          }
        };
      },
    }
  )
);

// Listen for system theme changes when theme is 'system'
if (typeof window !== 'undefined') {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const { theme } = useAppStore.getState();
    if (theme === 'system') {
      applyThemeToDOM('system');
    }
  });

  // Apply theme on initial load
  const stored = localStorage.getItem('qiniu-browser-settings');
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      applyThemeToDOM(parsed?.state?.theme || 'system');
    } catch {
      applyThemeToDOM('system');
    }
  }
}
