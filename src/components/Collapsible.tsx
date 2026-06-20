import React, { useState } from 'react'

interface Props {
  summary: string
  defaultOpen?: boolean
  children: React.ReactNode
}

/**
 * A disclosure used to tuck technical/advanced details out of the way so the
 * default flow stays simple, while still being one click away when needed.
 */
export default function Collapsible({ summary, defaultOpen = false, children }: Props) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="collapsible">
      <button type="button" className="collapsible-toggle" onClick={() => setOpen((o) => !o)}>
        <span className={`collapsible-caret ${open ? 'open' : ''}`}>▸</span>
        {summary}
      </button>
      {open && <div className="collapsible-body">{children}</div>}
    </div>
  )
}
