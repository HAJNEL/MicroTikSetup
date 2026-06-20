import React, { useEffect, useState } from 'react'
import CredentialsForm from '../components/CredentialsForm'
import LogConsole from '../components/LogConsole'
import { SshCredentials, WifiInterfaceInfo } from '../types'

export default function WifiPage() {
  const [creds, setCreds] = useState<SshCredentials>({ routerIp: '', username: 'admin', password: '' })
  const [detecting, setDetecting] = useState(true)
  const [stage, setStage] = useState<'creds' | 'pick' | 'configure' | 'done'>('creds')
  const [useNewWifiPackage, setUseNewWifiPackage] = useState(false)
  const [networks, setNetworks] = useState<WifiInterfaceInfo[]>([])
  const [target, setTarget] = useState<WifiInterfaceInfo | null>(null)
  const [ssid, setSsid] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resetKey, setResetKey] = useState(0)
  const [dropped, setDropped] = useState(false)

  useEffect(() => {
    window.api.network.detectRouterIp().then((ip) => {
      if (ip) setCreds((c) => ({ ...c, routerIp: ip }))
      setDetecting(false)
    })
  }, [])

  async function loadNetworks() {
    setError(null)
    setBusy(true)
    setResetKey((k) => k + 1)
    try {
      const result = await window.api.workflow.wifi.listNetworks(creds)
      if ('networks' in result) {
        setUseNewWifiPackage(result.useNewWifiPackage)
        setNetworks(result.networks)
        setStage('pick')
      } else {
        setError(result.message ?? 'Could not list wireless interfaces.')
      }
    } catch (ex: any) {
      setError(ex?.message ?? String(ex))
    } finally {
      setBusy(false)
    }
  }

  function pick(net: WifiInterfaceInfo) {
    setTarget(net)
    setSsid(net.ssid === '(no SSID set)' ? '' : net.ssid)
    setStage('configure')
  }

  async function apply() {
    if (!target) return
    setError(null)
    setBusy(true)
    setResetKey((k) => k + 1)
    try {
      const res = await window.api.workflow.wifi.apply(creds, useNewWifiPackage, target, ssid, password)
      if (res.ok) {
        setDropped(Boolean(res.connectionDropped))
        setStage('done')
      } else {
        setError(res.message ?? 'Failed to apply changes.')
      }
    } catch (ex: any) {
      setError(ex?.message ?? String(ex))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="panel">
        <h2>Change WiFi name &amp; password</h2>
        <p className="muted">Connects to a MikroTik router over SSH and updates its SSID + WPA2 passphrase.</p>

        {detecting && <p className="muted">Detecting your current router (default gateway)...</p>}

        <CredentialsForm value={creds} onChange={setCreds} disabled={busy || stage !== 'creds'} />

        {stage === 'creds' && (
          <div className="actions">
            <button className="primary" onClick={loadNetworks} disabled={busy || !creds.routerIp || !creds.password}>
              {busy ? 'Connecting...' : 'Connect & list WiFi networks'}
            </button>
          </div>
        )}

        {error && <div className="banner error" style={{ marginTop: 14 }}>{error}</div>}
      </div>

      {stage === 'pick' && (
        <div className="panel">
          <h2>Available WiFi networks on this router</h2>
          <table>
            <thead>
              <tr>
                <th>SSID</th>
                <th>Interface</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {networks.map((n) => (
                <tr key={n.name}>
                  <td>{n.ssid}</td>
                  <td>{n.name}</td>
                  <td>
                    <button onClick={() => pick(n)}>Configure</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {stage === 'configure' && target && (
        <div className="panel">
          <h2>
            Renaming &quot;{target.ssid}&quot; (interface {target.name})
          </h2>
          <div className="field">
            <label>New WiFi network name (SSID)</label>
            <input value={ssid} onChange={(e) => setSsid(e.target.value)} disabled={busy} />
          </div>
          <div className="field">
            <label>New WiFi password (WPA2, min 8 characters)</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} />
          </div>
          <div className="banner warn">
            If you're connected to this router over the WiFi network you're about to rename/re-secure, the
            connection will drop partway through — that's expected, not an error.
          </div>
          <div className="actions">
            <button className="primary" onClick={apply} disabled={busy || password.length < 8 || !ssid}>
              {busy ? 'Applying...' : 'Apply changes'}
            </button>
            <button onClick={() => setStage('pick')} disabled={busy}>
              Back
            </button>
          </div>
        </div>
      )}

      {stage === 'done' && (
        <div className="panel">
          <div className={`banner ${dropped ? 'warn' : 'success'}`}>
            {dropped
              ? `The session was dropped while applying the change — expected when connected over the WiFi network being reconfigured. Reconnect to "${ssid}" with the new password.`
              : 'WiFi name and password updated successfully.'}
          </div>
          <div className="actions">
            <button
              className="primary"
              onClick={() => {
                setStage('creds')
                setNetworks([])
                setTarget(null)
                setSsid('')
                setPassword('')
              }}
            >
              Done
            </button>
          </div>
        </div>
      )}

      <div className="panel">
        <LogConsole resetKey={resetKey} />
      </div>
    </div>
  )
}
