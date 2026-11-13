import { useState, useEffect, type ReactNode } from "react";
import { toast } from "@/lib/toast";
import { useAppStore, Theme } from "../store";
import { Palette, LayoutList, Timer, Trash2, Info } from "lucide-react";
import { Button } from "./ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "./ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "./ui/dialog";
import { cn } from "@/lib/utils";

const THEME_ITEMS: { value: Theme; label: string }[] = [
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
  { value: "system", label: "跟随系统" },
];

const PAGE_SIZE_ITEMS = [
  { value: "20", label: "20" },
  { value: "50", label: "50" },
  { value: "100", label: "100" },
  { value: "200", label: "200" },
];

const CACHE_EXPIRE_ITEMS = [
  { value: "1", label: "1 分钟" },
  { value: "5", label: "5 分钟" },
  { value: "15", label: "15 分钟" },
  { value: "30", label: "30 分钟" },
];

const rowClass =
  "flex min-h-11 w-full items-center gap-3 border-b border-zinc-200/70 px-3.5 py-2.5 text-left last:border-b-0 dark:border-zinc-800";

function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="px-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">{title}</h3>
      <div className="overflow-hidden rounded-xl bg-zinc-50 ring-1 ring-zinc-200/80 dark:bg-zinc-900/80 dark:ring-zinc-800">
        {children}
      </div>
    </section>
  );
}

function SettingsSelectRow({
  icon: Icon,
  label,
  items,
  value,
  onValueChange,
  "aria-label": ariaLabel,
}: {
  icon: typeof Palette;
  label: string;
  items: { value: string; label: string }[];
  value: string;
  onValueChange: (value: string | null) => void;
  "aria-label": string;
}) {
  return (
    <Select items={items} value={value} onValueChange={onValueChange}>
      <SelectTrigger
        aria-label={ariaLabel}
        className={cn(
          rowClass,
          "h-auto rounded-none border-0 border-b bg-transparent px-3.5 shadow-none",
          "hover:bg-zinc-100/80 dark:bg-transparent dark:hover:bg-zinc-800/50",
          "focus-visible:border-transparent focus-visible:ring-0 data-[size=default]:h-auto",
          "justify-between gap-3",
        )}
      >
        <Icon className="size-4 shrink-0 text-zinc-400 dark:text-zinc-500" />
        <span className="min-w-0 flex-1 text-left text-sm font-normal text-zinc-800 dark:text-zinc-100">{label}</span>
        <SelectValue className="max-w-fit flex-none grow-0 shrink-0 text-sm text-zinc-500 dark:text-zinc-400" />
      </SelectTrigger>
      <SelectContent align="end" alignItemWithTrigger={false} className="!w-auto min-w-28">
        {items.map(item => (
          <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function SettingsActionRow({
  icon: Icon,
  label,
  value,
  onClick,
}: {
  icon: typeof Palette;
  label: string;
  value: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        rowClass,
        "cursor-pointer transition-colors hover:bg-zinc-100/80 dark:hover:bg-zinc-800/50",
      )}
    >
      <Icon className="size-4 shrink-0 text-zinc-400 dark:text-zinc-500" />
      <span className="min-w-0 flex-1 text-sm text-zinc-800 dark:text-zinc-100">{label}</span>
      <span className="shrink-0 text-sm text-zinc-500 dark:text-zinc-400">{value}</span>
    </button>
  );
}

export function SettingsPanel({ appVersion }: { appVersion: string }) {
  const {
    theme, setTheme,
    itemsPerPage, setItemsPerPage,
    cacheExpireMinutes, setCacheExpireMinutes,
  } = useAppStore();

  const [cacheSize, setCacheSize] = useState<string>("计算中...");
  const [clearOpen, setClearOpen] = useState(false);

  const calcCacheSize = () => {
    try {
      let totalSize = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) {
          const value = localStorage.getItem(key);
          if (value) totalSize += key.length + value.length;
        }
      }
      setCacheSize(`${(totalSize / 1024).toFixed(2)} KB`);
    } catch {
      setCacheSize("无法计算");
    }
  };

  useEffect(() => {
    calcCacheSize();
  }, []);

  const handleClearCache = () => {
    const settingsKeys = ["qiniu-browser-settings", "qiniu_auto_login", "qiniu_last_login_ak", "qiniu_session"];
    const settingsData: Record<string, string> = {};
    settingsKeys.forEach(key => {
      const value = localStorage.getItem(key);
      if (value) settingsData[key] = value;
    });
    localStorage.clear();
    Object.entries(settingsData).forEach(([key, value]) => {
      localStorage.setItem(key, value);
    });
    toast.success("缓存已清除");
    setClearOpen(false);
    calcCacheSize();
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto w-full max-w-lg space-y-5">
          <SettingsSection title="外观">
            <SettingsSelectRow
              icon={Palette}
              label="主题"
              aria-label="主题"
              items={THEME_ITEMS}
              value={theme}
              onValueChange={value => {
                if (value === "light" || value === "dark" || value === "system") setTheme(value);
              }}
            />
            <SettingsSelectRow
              icon={LayoutList}
              label="每页显示"
              aria-label="每页显示"
              items={PAGE_SIZE_ITEMS}
              value={String(itemsPerPage)}
              onValueChange={value => {
                if (value === "20" || value === "50" || value === "100" || value === "200") {
                  setItemsPerPage(Number(value) as 20 | 50 | 100 | 200);
                }
              }}
            />
          </SettingsSection>

          <SettingsSection title="缓存">
            <SettingsSelectRow
              icon={Timer}
              label="过期时间"
              aria-label="过期时间"
              items={CACHE_EXPIRE_ITEMS}
              value={String(cacheExpireMinutes)}
              onValueChange={value => {
                const minutes = Number(value);
                if ([1, 5, 15, 30].includes(minutes)) setCacheExpireMinutes(minutes);
              }}
            />
            <SettingsActionRow
              icon={Trash2}
              label="清除缓存"
              value={`已使用 ${cacheSize}`}
              onClick={() => setClearOpen(true)}
            />
          </SettingsSection>

          <SettingsSection title="其他">
            <div className={rowClass}>
              <Info className="size-4 shrink-0 text-zinc-400 dark:text-zinc-500" />
              <span className="min-w-0 flex-1 text-sm text-zinc-800 dark:text-zinc-100">关于</span>
              <span className="shrink-0 text-sm text-zinc-500 dark:text-zinc-400">
                Qiniu Browser · v{appVersion}
              </span>
            </div>
          </SettingsSection>
        </div>
      </div>

      <Dialog open={clearOpen} onOpenChange={setClearOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>清除缓存</DialogTitle>
            <DialogDescription>
              将清除本地缓存数据（约 {cacheSize}），登录状态与偏好设置会保留。此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClearOpen(false)}>取消</Button>
            <Button variant="destructive" onClick={handleClearCache}>确认清除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
