import { useState, useEffect, createContext, useContext, useCallback } from 'react';
import { cn } from '@/lib/utils';

interface ToastItem {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
}

interface ToastContextType {
  toast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

const ToastContext = createContext<ToastContextType>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

let toastId = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const toast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = ++toastId;
    setToasts(prev => [...prev, { id, message, type }]);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map(t => (
          <ToastItem key={t.id} item={t} onRemove={() => setToasts(prev => prev.filter(x => x.id !== t.id))} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ item, onRemove }: { item: ToastItem; onRemove: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onRemove, 4000);
    return () => clearTimeout(timer);
  }, [onRemove]);

  return (
    <div
      className={cn(
        'px-4 py-3 rounded-lg border text-sm shadow-lg max-w-sm animate-[slideIn_0.2s_ease-out]',
        item.type === 'success' && 'bg-gh-green/10 border-gh-green/30 text-gh-green',
        item.type === 'error' && 'bg-gh-red/10 border-gh-red/30 text-gh-red',
        item.type === 'info' && 'bg-gh-accent/10 border-gh-accent/30 text-gh-accent',
      )}
    >
      {item.message}
    </div>
  );
}
