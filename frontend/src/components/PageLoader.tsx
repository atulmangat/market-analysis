/** Full-page skeleton shown while the initial API call is in-flight. */
export function PageLoader() {
  return (
    <div className="space-y-4 animate-pulse">
      {/* Stat row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="rounded-xl border border-borderLight bg-surface p-5 space-y-3">
            <div className="h-2.5 bg-surface3 rounded w-2/5" />
            <div className="h-8 bg-surface3 rounded w-1/4" />
          </div>
        ))}
      </div>
      {/* Card rows */}
      {[1, 2, 3].map(i => (
        <div key={i} className="rounded-xl border border-borderLight bg-surface p-5 space-y-3">
          <div className="h-3 bg-surface3 rounded w-1/5" />
          {[1, 2, 3].map(j => (
            <div key={j} className="flex items-center gap-4 py-2">
              <div className="h-8 w-8 rounded-lg bg-surface3 shrink-0" style={{ opacity: 1 - j * 0.2 }} />
              <div className="flex-1 space-y-2">
                <div className="h-3 bg-surface3 rounded" style={{ width: `${45 - j * 5}%`, opacity: 1 - j * 0.2 }} />
                <div className="h-2.5 bg-surface3 rounded" style={{ width: `${65 - j * 5}%`, opacity: 1 - j * 0.2 }} />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
