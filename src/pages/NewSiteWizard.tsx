import React, { useEffect, useState } from 'react'
import LogConsole from '../components/LogConsole'
import { SETUP_STEP_LABELS, STEP_CHANGE_BRIDGE_IP, SiteRecord } from '../types'

interface Props {
  onFinished: () => void
}

type Stage = 'form' | 'steps' | 'confirmLaptopIp' | 'confirmPlan' | 'running' | 'result'

export default function NewSiteWizard({ onFinished }: Props) {
  const [stage, setStage] = useState<Stage>('form')

  const [siteName, setSiteName] = useState('')
  const [wgIp, setWgIp] = useState('')
  const [lanThird, setLanThird] = useState<number>(0)
  const [nameWarning, setNameWarning] = useState<string | null>(null)
  const [subnetWarning, setSubnetWarning] = useState<string | null>(null)

  const [steps, setSteps] = useState<boolean[]>(SETUP_STEP_LABELS.map(() => true))

  const [routerIp, setRouterIp] = useState('')
  const [detecting, setDetecting] = useState(true)
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')

  const [resetKey, setResetKey] = useState(0)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message?: string; peerBlock?: string; site?: SiteRecord } | null>(
    null,
  )

  useEffect(() => {
    window.api.sites.suggestNext().then((sug) => {
      setWgIp(`10.10.0.${sug.wgOctet}`)
      setLanThird(sug.lanThirdOctet)
    })
    window.api.network.detectRouterIp().then((ip) => {
      if (ip) setRouterIp(ip)
      setDetecting(false)
    })
  }, [])

  async function proceedFromForm() {
    setNameWarning(null)
    setSubnetWarning(null)
    if (!siteName.trim()) return
    const lanSubnet = `192.168.${lanThird}.0/24`
    const [nameExists, subnetInUse] = await Promise.all([
      window.api.sites.nameExists(siteName),
      window.api.sites.subnetInUse(lanSubnet),
    ])
    if (nameExists) setNameWarning(`A site named "${siteName}" already exists in the tracking CSV.`)
    if (subnetInUse)
      setSubnetWarning(
        `LAN subnet ${lanSubnet} is already recorded for another site. Each site MUST have a unique LAN subnet, or routing on the EC2 server will break.`,
      )
    setStage('steps')
  }

  function toggleStep(i: number) {
    setSteps((prev) => prev.map((v, idx) => (idx === i ? !v : v)))
  }

  function proceedFromSteps() {
    if (steps[STEP_CHANGE_BRIDGE_IP]) {
      setStage('confirmLaptopIp')
    } else {
      setStage('confirmPlan')
    }
  }

  const lanSubnet = `192.168.${lanThird}.0/24`
  const mikroTikLanIp = `192.168.${lanThird}.1`
  const deviceIp = `192.168.${lanThird}.200`

  async function run() {
    setStage('running')
    setRunning(true)
    setResetKey((k) => k + 1)
    try {
      const res = await window.api.workflow.runSetup({
        siteName,
        wireGuardIp: wgIp,
        lanThirdOctet: lanThird,
        currentRouterIp: routerIp,
        username,
        password,
        steps,
      })
      setResult(res)
    } catch (ex: any) {
      setResult({ ok: false, message: ex?.message ?? String(ex) })
    } finally {
      setRunning(false)
      setStage('result')
    }
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>New Remote Site Setup</h2>
      <p className="muted">
        Configures a MikroTik wAP LTE router for a new HikCentral site, following the HikCentral Remote Site Setup
        Guide. Make sure you're connected to the router's current LAN (default 192.168.88.1).
      </p>

      {stage === 'form' && (
        <div className="panel">
          <div className="field">
            <label>Site name</label>
            <input value={siteName} onChange={(e) => setSiteName(e.target.value)} placeholder="e.g. Riverland" />
          </div>
          <div className="row">
            <div className="field">
              <label>WireGuard IP for this site</label>
              <input value={wgIp} onChange={(e) => setWgIp(e.target.value)} />
            </div>
            <div className="field">
              <label>LAN subnet third octet</label>
              <input
                type="number"
                value={lanThird}
                onChange={(e) => setLanThird(parseInt(e.target.value, 10) || 0)}
              />
            </div>
          </div>
          <p className="muted">
            Will use LAN subnet <code>192.168.{lanThird}.0/24</code>, MikroTik IP <code>192.168.{lanThird}.1</code>,
            device IP <code>192.168.{lanThird}.200</code>.
          </p>
          <div className="actions">
            <button className="primary" onClick={proceedFromForm} disabled={!siteName.trim() || !lanThird}>
              Next: choose setup steps
            </button>
          </div>
        </div>
      )}

      {stage === 'steps' && (
        <div className="panel">
          {nameWarning && <div className="banner warn">{nameWarning}</div>}
          {subnetWarning && <div className="banner warn">{subnetWarning}</div>}
          <h2>Select which setup steps to run for this site</h2>
          <div className="checklist">
            {SETUP_STEP_LABELS.map((label, i) => (
              <label key={i}>
                <input type="checkbox" checked={steps[i]} onChange={() => toggleStep(i)} />
                {label}
              </label>
            ))}
          </div>
          {!steps[2] && (steps[3] || steps[4] || steps[5] || steps[6]) && (
            <div className="banner warn">
              Firewall/MSS/NAT/watchdog steps assume the WireGuard tunnel already exists on this router (you've
              unchecked "Configure WireGuard tunnel"). Make sure that's true.
            </div>
          )}
          <div className="actions">
            <button onClick={() => setStage('form')}>Back</button>
            <button className="primary" onClick={proceedFromSteps}>
              Next
            </button>
          </div>
        </div>
      )}

      {stage === 'confirmLaptopIp' && (
        <div className="panel">
          <h2>Action required before continuing (Step 1.10)</h2>
          <p>On THIS computer, set your Ethernet adapter to a manual/static IP on the NEW subnet:</p>
          <ul>
            <li>
              IP address: <code>192.168.{lanThird}.2</code>
            </li>
            <li>
              Subnet mask: <code>255.255.255.0</code>
            </li>
            <li>
              Gateway: <code>{mikroTikLanIp}</code>
            </li>
            <li>
              DNS: <code>8.8.8.8</code>
            </li>
          </ul>
          <div className="banner warn">
            If you skip this, you will lose access to the router after the bridge IP changes, and will need to
            reconnect via WinBox → Neighbors → MAC address. You can use the "IP assignment setup" action from a
            site's detail page to apply this automatically once the site is saved — for a brand-new site, set it
            manually via Windows Settings → Network &amp; Internet for now.
          </div>
          <div className="actions">
            <button onClick={() => setStage('steps')}>Back</button>
            <button className="primary" onClick={() => setStage('confirmPlan')}>
              I've finished changing my computer's IP as shown above
            </button>
          </div>
        </div>
      )}

      {stage === 'confirmPlan' && (
        <div className="panel">
          <h2>Plan summary</h2>
          <p>
            <span className="muted">Site name:</span> {siteName}
          </p>
          <p>
            <span className="muted">WireGuard IP:</span> <code>{wgIp}/24</code>
          </p>
          <p>
            <span className="muted">LAN subnet:</span> <code>{lanSubnet}</code>
          </p>
          <p>
            <span className="muted">MikroTik LAN IP:</span> <code>{mikroTikLanIp}</code>
          </p>
          <p>
            <span className="muted">Device IP:</span> <code>{deviceIp}</code>
          </p>

          <h2>Router connection (current address, before any changes)</h2>
          {detecting && <p className="muted">Detecting your current router (default gateway)...</p>}
          <div className="row">
            <div className="field">
              <label>Router's current IP (the address you connect to right now)</label>
              <input value={routerIp} onChange={(e) => setRouterIp(e.target.value)} placeholder="192.168.88.1" />
            </div>
            <div className="field">
              <label>SSH username</label>
              <input value={username} onChange={(e) => setUsername(e.target.value)} />
            </div>
            <div className="field">
              <label>SSH password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
          </div>

          <div className="actions">
            <button onClick={() => setStage(steps[STEP_CHANGE_BRIDGE_IP] ? 'confirmLaptopIp' : 'steps')}>Back</button>
            <button className="primary" onClick={run} disabled={!routerIp || !password}>
              Proceed with this plan
            </button>
          </div>
        </div>
      )}

      {(stage === 'running' || stage === 'result') && (
        <div className="panel">
          <h2>{running ? 'Running setup...' : 'Setup finished'}</h2>
          <LogConsole resetKey={resetKey} />
        </div>
      )}

      {stage === 'result' && result && (
        <div className="panel">
          <div className={`banner ${result.ok ? 'success' : 'error'}`}>
            {result.ok ? 'Setup completed.' : `Setup finished with issues: ${result.message ?? ''}`}
          </div>

          {result.peerBlock && (
            <>
              <h2>Add this [Peer] block to the EC2 WireGuard (KyospanServer) config</h2>
              <p className="muted">Do NOT remove or modify any existing [Peer] sections — only append this one.</p>
              <pre className="console" style={{ whiteSpace: 'pre' }}>
                {result.peerBlock}
              </pre>
            </>
          )}

          <h2>Next: configure the Hikvision device via its web UI</h2>
          <ul>
            <li>
              Static IP: <code>{deviceIp}</code>
            </li>
            <li>
              Subnet mask: <code>255.255.255.0</code>
            </li>
            <li>
              Default gateway: <code>{mikroTikLanIp}</code>
            </li>
            <li>
              DNS: <code>8.8.8.8</code>
            </li>
            <li>NTP server: pool.ntp.org</li>
            <li>SDK port: 8000 (leave default)</li>
          </ul>
          <p className="muted">Don't forget to reset this computer's IP back to DHCP once everything is verified.</p>

          <div className="actions">
            <button className="primary" onClick={onFinished}>
              Done — go to Configured Sites
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
