/**
 * Lightweight markdown renderer — handles the subset agents produce:
 *   **bold**, *italic*, ### headers, - bullet lists, numbered lists, blank-line paragraphs.
 * No external dependency needed.
 */

function parseInline(text: string): React.ReactNode[] {
  // Split on **bold** and *italic* markers
  const parts: React.ReactNode[] = [];
  const re = /(\*\*(.+?)\*\*|\*(.+?)\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[0].startsWith('**')) {
      parts.push(<strong key={m.index} className="text-textMain font-semibold">{m[2]}</strong>);
    } else {
      parts.push(<em key={m.index} className="italic">{m[3]}</em>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export function MarkdownText({ text, className = '' }: { text: string; className?: string }) {
  // Split into blocks by blank lines
  const blocks = text.split(/\n{2,}/);

  return (
    <div className={`space-y-2 ${className}`}>
      {blocks.map((block, bi) => {
        const lines = block.split('\n').map(l => l.trimEnd());

        // Heading: ### or ## or #
        if (/^#{1,3}\s/.test(lines[0])) {
          const lvl = lines[0].match(/^(#{1,3})\s/)![1].length;
          const content = lines[0].replace(/^#{1,3}\s+/, '');
          const cls = lvl === 1
            ? 'text-xs font-bold text-textMain mt-1'
            : lvl === 2
            ? 'text-[11px] font-bold text-textMain mt-1'
            : 'text-[11px] font-semibold text-textDim uppercase tracking-wider mt-1';
          return <p key={bi} className={cls}>{parseInline(content)}</p>;
        }

        // List block: lines starting with - or * or 1.
        const isList = lines.every(l => /^[-*]\s/.test(l) || /^\d+\.\s/.test(l) || l === '');
        if (isList && lines.some(l => /^[-*]\s/.test(l) || /^\d+\.\s/.test(l))) {
          return (
            <ul key={bi} className="space-y-0.5 pl-3">
              {lines.filter(l => l).map((l, li) => {
                const content = l.replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, '');
                return (
                  <li key={li} className="flex gap-1.5 text-[11px] text-textMuted leading-relaxed">
                    <span className="text-textDim shrink-0 mt-px">·</span>
                    <span>{parseInline(content)}</span>
                  </li>
                );
              })}
            </ul>
          );
        }

        // Regular paragraph — join lines with space
        const combined = lines.join(' ').trim();
        if (!combined) return null;
        return (
          <p key={bi} className="text-[11px] text-textMuted leading-relaxed">
            {parseInline(combined)}
          </p>
        );
      })}
    </div>
  );
}
