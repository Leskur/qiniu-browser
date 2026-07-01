import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { QiniuBucket } from '../lib/qiniu'

export type Theme = 'light' | 'dark' | 'system';

export interface Bookmark {
  id: string;
  bucket: string;
  prefix: string;
  label: string;
  createdAt: number;
}

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
  
  // 域名缓存
  bucketDomains: Map<string, { domains: string[]; timestamp: number }>;
  setBucketDomains: (bucket: string, domains: string[]) => void;
  getBucketDomains: (bucket: string) => string[] | null;
  
  // 通知设置
  notifyOnComplete: boolean;
  setNotifyOnComplete: (notify: boolean) => void;

  // 书签（按 AK 隔离）
  bookmarks: Record<string, Bookmark[]>;
  addBookmark: (ak: string, bookmark: Omit<Bookmark, 'id' | 'createdAt'>) => void;
  removeBookmark: (ak: string, id: string) => void;
  getBookmarks: (ak: string) => Bookmark[];
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
      
      // 域名缓存（1小时过期）
      bucketDomains: new Map(),
      setBucketDomains: (bucket, domains) => {
        set((state) => {
          const newMap = new Map(state.bucketDomains);
          newMap.set(bucket, { domains, timestamp: Date.now() });
          return { bucketDomains: newMap };
        });
      },
      getBucketDomains: (bucket) => {
        const cached = get().bucketDomains.get(bucket);
        if (!cached) return null;
        
        // Check if expired (1 hour)
        const DOMAIN_CACHE_TTL = 60 * 60 * 1000;
        if (Date.now() - cached.timestamp > DOMAIN_CACHE_TTL) {
          // Expired, remove from cache
          set((state) => {
            const newMap = new Map(state.bucketDomains);
            newMap.delete(bucket);
            return { bucketDomains: newMap };
          });
          return null;
        }
        
        return cached.domains;
      },
      
      // 通知设置
      notifyOnComplete: true,
      setNotifyOnComplete: (notify) => set({ notifyOnComplete: notify }),

      // 书签（按 AK 隔离）
      bookmarks: {},
      addBookmark: (ak, bookmark) => {
        const id = crypto.randomUUID();
        const newBookmark: Bookmark = { ...bookmark, id, createdAt: Date.now() };
        set((state) => {
          const list = state.bookmarks[ak] || [];
          // 避免重复：相同 bucket + prefix 的不重复添加
          const exists = list.some(b => b.bucket === bookmark.bucket && b.prefix === bookmark.prefix);
          if (exists) return state;
          return { bookmarks: { ...state.bookmarks, [ak]: [...list, newBookmark] } };
        });
      },
      removeBookmark: (ak, id) => {
        set((state) => {
          const list = state.bookmarks[ak] || [];
          return { bookmarks: { ...state.bookmarks, [ak]: list.filter(b => b.id !== id) } };
        });
      },
      getBookmarks: (ak) => {
        return get().bookmarks[ak] || [];
      },
    }),
    {
      name: 'qiniu-browser-settings',
      // 持久化所有设置（除了 buckets 运行时数据）
      partialize: (state) => ({
        theme: state.theme,
        itemsPerPage: state.itemsPerPage,
        cacheExpireMinutes: state.cacheExpireMinutes,
        notifyOnComplete: state.notifyOnComplete,
        bookmarks: state.bookmarks,
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
