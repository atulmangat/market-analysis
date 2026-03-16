import type { Toast } from '../types';

export function ToastList({ toasts }: { toasts: Toast[] }) {
  if (!toasts.length) return null;
  return (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[200] flex flex-col items-center gap-2 pointer-events-none">
      {toasts.map(t => (
        <div key={t.id} className={`px-4 py-2 rounded-lg text-xs font-medium shadow-lg border animate-fade-in ${
          t.type === 'err' ? 'bg-down-bg border-down/30 text-down-text' :
          t.type === 'info' ? 'bg-surface2 border-borderMid text-textMain' :
          'bg-up-bg border-up/30 text-up-text'
        }`}>{t.msg}</div>
      ))}
    </div>
  );
}
