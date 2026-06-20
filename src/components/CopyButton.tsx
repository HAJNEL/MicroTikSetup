import React, { useState } from 'react'

interface Props {
  value: string
  label?: string
  className?: string
}

/** Small button that copies a value to the clipboard and confirms with a tick. */
export default function CopyButton({ value, label = 'Copy', className }: Props) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard can fail if the window isn't focused — ignore quietly
    }
  }

  return (
    <button type="button" className={className} onClick={copy}>
      {copied ? '✓ Copied' : label}
    </button>
  )
}
