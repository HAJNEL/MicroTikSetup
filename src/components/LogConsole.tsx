import React, { useEffect, useRef, useState } from 'react'
import { LogLine } from '../types'

interface Props {
  /** Bump this to clear the console before starting a new run. */
  resetKey?: number
}

export default function LogConsole({ resetKey }: Props) {
  const [lines, setLines] = useState<LogLine[]>([])
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setLines([])
  }, [resetKey])

  useEffect(() => {
    const unsubscribe = window.api.workflow.onLog((line) => {
      setLines((prev) => [...prev, line])
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [lines])

  return (
    <div className="console" ref={ref}>
      {lines.length === 0 ? (
        <span className="l-info">Waiting for output...</span>
      ) : (
        lines.map((l, i) => (
          <div key={i} className={`l-${l.level}`}>
            {l.text || '\u00A0'}
          </div>
        ))
      )}
    </div>
  )
}
