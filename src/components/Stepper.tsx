import React from 'react'

interface Props {
  steps: string[]
  /** Index of the step currently in progress. */
  current: number
}

/**
 * A friendly labelled progress stepper shown across the top of multi-step flows,
 * so a field tech always knows where they are and what's left.
 */
export default function Stepper({ steps, current }: Props) {
  return (
    <div className="stepper">
      {steps.map((label, i) => {
        const state = i < current ? 'done' : i === current ? 'current' : 'todo'
        return (
          <div key={label} className={`stepper-step ${state}`}>
            <div className="stepper-dot">{state === 'done' ? '✓' : i + 1}</div>
            <div className="stepper-label">{label}</div>
          </div>
        )
      })}
    </div>
  )
}
