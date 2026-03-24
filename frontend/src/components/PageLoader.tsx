/** Full-page skeleton shown while the initial API call is in-flight. */
export function PageLoader() {
  return (
    <div className="space-y-4">
      {/* Stat row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="rounded-2xl border border-borderLight bg-surface p-5 space-y-3" style={{ animationDelay: `${i * 0.05}s` }}>
            <div className="h-2.5 shimmer rounded-lg w-2/5" />
            <div className="h-9 shimmer rounded-lg w-1/3" />
            <div className="h-2 shimmer rounded-lg w-3/5" />
          </div>
        ))}
      </div>
      {/* Card rows */}
      {[1, 2, 3].map(i => (
        <div key={i} className="rounded-2xl border border-borderLight bg-surface p-5 space-y-3">
          <div className="h-2.5 shimmer rounded-lg w-1/5 mb-4" />
          {[1, 2, 3].map(j => (
            <div key={j} className="flex items-center gap-4 py-2" style={{ opacity: 1 - (j - 1) * 0.25 }}>
              <div className="h-9 w-9 rounded-xl shimmer shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-3 shimmer rounded-lg" style={{ width: `${40 - j * 4}%` }} />
                <div className="h-2.5 shimmer rounded-lg" style={{ width: `${62 - j * 4}%` }} />
              </div>
              <div className="h-6 shimmer rounded-lg w-16 shrink-0" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
