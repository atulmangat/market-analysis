export function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className="relative inline-flex h-[22px] w-[40px] items-center rounded-full transition-all duration-250 cursor-pointer focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
      style={checked ? {
        background: 'linear-gradient(135deg, #2563eb 0%, #4f46e5 100%)',
        boxShadow: '0 0 12px rgba(37,99,235,0.4), inset 0 1px 0 rgba(255,255,255,0.15)',
      } : {
        background: 'var(--color-surface3)',
        border: '1px solid var(--color-borderMid)',
      }}
    >
      <span
        className={`inline-block h-[16px] w-[16px] rounded-full shadow-sm transition-transform duration-250 ease-out ${
          checked ? 'translate-x-[22px]' : 'translate-x-[2px]'
        }`}
        style={{
          background: checked ? '#fff' : 'var(--color-textDim)',
          boxShadow: checked ? '0 1px 4px rgba(0,0,0,0.3)' : 'none',
        }}
      />
    </button>
  );
}
