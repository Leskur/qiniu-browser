import type { ReactNode } from 'react';
import { toast as manager } from '@/components/ui/toast';

type ToastType = 'success' | 'info' | 'warning' | 'error' | 'loading';

interface ToastOptions {
  id?: string;
  description?: ReactNode;
  duration?: number;
  action?: { label: string; onClick: () => void };
}

// Keep notification callers independent of the underlying UI component.
function show(type: ToastType, title: ReactNode, options: ToastOptions = {}) {
  const duration = options.duration ?? (type === 'loading' ? 0 : 5000);
  return manager.add({
    id: options.id,
    type,
    title,
    description: options.description,
    timeout: duration === Infinity ? 0 : duration,
    priority: type === 'error' ? 'high' : 'low',
    actionProps: options.action ? {
      children: options.action.label,
      onClick: options.action.onClick,
    } : undefined,
  });
}

export const toast = {
  success: (title: ReactNode, options?: ToastOptions) => show('success', title, options),
  info: (title: ReactNode, options?: ToastOptions) => show('info', title, options),
  warning: (title: ReactNode, options?: ToastOptions) => show('warning', title, options),
  error: (title: ReactNode, options?: ToastOptions) => show('error', title, options),
  loading: (title: ReactNode, options?: ToastOptions) => show('loading', title, options),
  dismiss: (id?: string) => manager.close(id),
};
