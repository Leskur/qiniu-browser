import { useEffect, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, PanelLeft, Square, Copy, X } from 'lucide-react';
import { Button } from './ui/button';
import { Tooltip } from './ui/tooltip';
import { toast } from '../lib/toast';

const IS_WINDOWS = isTauri() && navigator.userAgent.includes('Windows');
const IS_MACOS = isTauri() && navigator.userAgent.includes('Macintosh');
export const HAS_CUSTOM_TITLEBAR = IS_WINDOWS || IS_MACOS;

export function WindowTitlebar({ showSidebarToggle, sidebarCollapsed, onToggleSidebar }: {
  showSidebarToggle: boolean;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!IS_WINDOWS) return;
    const window = getCurrentWindow();
    let disposed = false;
    const update = () => {
      void window.isMaximized().then(value => { if (!disposed) setMaximized(value); })
        .catch(error => console.error('读取窗口状态失败:', error));
    };
    update();
    const subscription = window.onResized(update);
    return () => {
      disposed = true;
      void subscription.then(unlisten => unlisten()).catch(console.error);
    };
  }, []);

  if (!HAS_CUSTOM_TITLEBAR) return null;

  const run = (action: () => Promise<void>) => {
    void action().catch(error => toast.error('窗口操作失败', { description: String(error) }));
  };
  const controls = 'flex h-full w-11 shrink-0 items-center justify-center outline-none transition-colors hover:bg-sidebar-accent focus-visible:bg-sidebar-accent';
  return (
    <header data-slot="window-titlebar" data-platform={IS_MACOS ? 'macos' : 'windows'}
      className={`flex h-(--window-titlebar-height) shrink-0 select-none items-center ${showSidebarToggle
        ? 'bg-sidebar text-sidebar-foreground'
        : 'bg-zinc-50 text-foreground dark:bg-background'}`}>
      {IS_MACOS && <div data-tauri-drag-region aria-hidden="true" className="h-full w-20 shrink-0" />}
      {showSidebarToggle && (
        <div className="flex w-14 shrink-0 justify-center">
          <Button variant="ghost" size="icon-sm" onClick={onToggleSidebar}
            title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
            aria-label={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
            aria-pressed={sidebarCollapsed}>
            <PanelLeft />
          </Button>
        </div>
      )}
      <div data-tauri-drag-region className="h-full min-w-0 flex-1" aria-hidden="true" />
      {IS_WINDOWS && (
        <>
          <Tooltip content="最小化" side="bottom">
            <button type="button" className={controls} aria-label="最小化"
              onClick={() => run(() => getCurrentWindow().minimize())}><Minus className="size-3.5" /></button>
          </Tooltip>
          <Tooltip content={maximized ? '还原' : '最大化'} side="bottom">
            <button type="button" className={controls} aria-label={maximized ? '还原' : '最大化'}
              onClick={() => run(() => getCurrentWindow().toggleMaximize())}>
              {maximized ? <Copy className="size-3" /> : <Square className="size-3" />}
            </button>
          </Tooltip>
          <Tooltip content="关闭" side="bottom">
            <button type="button" className={`${controls} hover:bg-red-600 hover:text-white focus-visible:bg-red-600 focus-visible:text-white`}
              aria-label="关闭窗口" onClick={() => run(() => getCurrentWindow().close())}><X className="size-4" /></button>
          </Tooltip>
        </>
      )}
    </header>
  );
}
