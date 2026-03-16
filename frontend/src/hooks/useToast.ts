import { useState } from 'react';
import type { Toast } from '../types';

let _toastId = 0;

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = (msg: string, type: Toast['type'] = 'ok') => {
    const id = ++_toastId;
    setToasts(p => [...p, { id, msg, type }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 3000);
  };
  return { toasts, push };
}
