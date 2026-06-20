import React, { useState } from 'react'
import CredentialsForm from '../components/CredentialsForm'
import LogConsole from '../components/LogConsole'
import { SiteRecord, SshCredentials, WorkflowResult } from '../types'

interface Props {
  site: SiteRecord
  title: string
  description: string
  confirmLabel: string
  run: (creds: SshCredentials) => Promise<WorkflowResult>
}

export default function SshActionPanel({ site, title, description, confirmLabel, run }: Props) {
  const [creds, setCreds] = useState<SshCredentials>({
    routerIp: site.mikroTikLanIp || '192.168.88.1',
    username: 'admin',
    password: '',
  })
  const [running, setRunning] = useState(false)
  const [resetKey, setResetKey] = useState(0)
  const [result, setResult] = useState<WorkflowResult | null>(null)

  async function handleRun() {
    setResetKey((k) => k + 1)
    setResult(null)
    setRunning(true)
    try {
      const res = await run(creds)
      setResult(res)
    } catch (ex: any) {
      setResult({ ok: false, message: ex?.message ?? String(ex) })
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="panel">
      <h2>{title}</h2>
      <p className="muted">{description}</p>
      <CredentialsForm value={creds} onChange={setCreds} disabled={running} />
      <div className="actions">
        <button className="primary" onClick={handleRun} disabled={running || !creds.routerIp || !creds.password}>
          {running ? 'Running...' : confirmLabel}
        </button>
      </div>
      {result && (
        <div className={`banner ${result.ok ? 'success' : 'error'}`} style={{ marginTop: 14 }}>
          {result.ok ? 'Completed.' : `Failed: ${result.message ?? 'unknown error'}`}
        </div>
      )}
      <div style={{ marginTop: 14 }}>
        <LogConsole resetKey={resetKey} />
      </div>
    </div>
  )
}
