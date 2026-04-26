import React, { useMemo } from 'react'
import { diffLines } from 'diff'
import { cn } from '@/lib/utils'

export default function DiffView({
  oldText,
  newText,
}: {
  oldText: string
  newText: string
}) {
  const parts = useMemo(() => {
    return diffLines(oldText ?? '', newText ?? '', { newlineIsToken: true })
  }, [oldText, newText])

  return (
    <div className="rounded-lg border border-border-subtle bg-bg-primary/40 overflow-hidden">
      <div className="max-h-[360px] overflow-auto">
        <pre className="text-[11px] leading-relaxed font-mono p-3 whitespace-pre-wrap break-words">
          {parts.map((p, idx) => {
            const cls = p.added
              ? 'text-accent-success bg-accent-success/5'
              : p.removed
                ? 'text-accent-error bg-accent-error/5'
                : 'text-text-primary'
            const prefix = p.added ? '+ ' : p.removed ? '- ' : '  '
            // For newlineIsToken parts, value can be "\n" many times: keep it but avoid prefix on empty
            return (
              <span key={idx} className={cn('block px-1 rounded', cls)}>
                {p.value
                  .split('\n')
                  .map((line, i, arr) => {
                    const isLast = i === arr.length - 1
                    // keep trailing newline handling
                    return (
                      <React.Fragment key={i}>
                        {!isLast ? `${prefix}${line}\n` : line === '' ? '' : `${prefix}${line}`}
                      </React.Fragment>
                    )
                  })}
              </span>
            )
          })}
        </pre>
      </div>
    </div>
  )
}

