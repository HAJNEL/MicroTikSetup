import React, { useEffect, useMemo, useState } from 'react'
import LogConsole from '../components/LogConsole'
import Stepper from '../components/Stepper'
import Collapsible from '../components/Collapsible'
import CopyButton from '../components/CopyButton'
import { SETUP_STEP_LABELS, STEP_CHANGE_BRIDGE_IP, SiteRecord, NetworkAdapterInfo } from '../types'

interface Props {
  onFinished: () => void
  onCancel: () => void
}

type Stage = 'name' | 'connect' | 'prepComputer' | 'review' | 'running' | 'result'

export default function NewSiteWizard({ onFinished, onCancel }: Props) {
  const [stage, setStage] = useState<Stage>('name')

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

  // This-computer IP helper (for the "prepare your computer" step)
  const [adapters, setAdapters] = useState<NetworkAdapterInfo[]>([])
  const [adapter, setAdapter] = useState('')
  const [ipApplying, setIpApplying] = useState(false)
  const [ipResult, setIpResult] = useState<{ ok: boolean; text: string } | null>(null)

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
    window.api.network.listAdapters().then((list) => {
      setAdapters(list)
      const ethernet = list.find((a) => a.kind === 'Ethernet')
      setAdapter((ethernet ?? list[0])?.name ?? '')
    })
  }, [])

  const lanSubnet = `192.168.${lanThird}.0/24`
  const mikroTikLanIp = `192.168.${lanThird}.1`
  const deviceIp = `192.168.${lanThird}.200`
  const myComputerIp = `192.168.${lanThird}.2`
  const changesBridge = steps[STEP_CHANGE_BRIDGE_IP]

  // Stepper labels adapt to whether the LAN-IP change (and thus the computer-prep step) is in play.
  const stageOrder: Stage[] = changesBridge
    ? ['name', 'connect', 'prepComputer', 'review', 'running']
    : ['name', 'connect', 'review', 'running']
  const stepperLabels = changesBridge
    ? ['Name', 'Connect', 'Your PC', 'Review', 'Run']
    : ['Name', 'Connect', 'Review', 'Run']
  const currentStepIndex = useMemo(() => {
    const s: Stage = stage === 'result' ? 'running' : stage
    const idx = stageOrder.indexOf(s)
    return idx < 0 ? 0 : idx
  }, [stage, stageOrder])

  async function proceedFromName() {
    setNameWarning(null)
    setSubnetWarning(null)
    if (!siteName.trim() || !lanThird) return
    const [nameExists, subnetInUse] = await Promise.all([
      window.api.sites.nameExists(siteName),
      window.api.sites.subnetInUse(lanSubnet),
    ])
    if (nameExists) setNameWarning(`A site named "${siteName}" already exists. Pick a different name to avoid confusion.`)
    if (subnetInUse)
      setSubnetWarning(
        `Network 192.168.${lanThird}.x is already used by another site. Each site must use its own network, or the VPN routing on the server will break. Open "Advanced settings" to change it.`,
      )
    setStage('connect')
  }

  function toggleStep(i: number) {
    setSteps((prev) => prev.map((v, idx) => (idx === i ? !v : v)))
  }

  function afterConnect() {
    setStage(changesBridge ? 'prepComputer' : 'review')
  }

  async function applyMyIp() {
    if (!adapter) return
    setIpApplying(true)
    setIpResult(null)
    try {
      const ok = await window.api.network.applyStaticIp(adapter, myComputerIp, '255.255.255.0', mikroTikLanIp, '8.8.8.8')
      setIpResult(
        ok
          ? { ok: true, text: `Done — "${adapter}" is now set to ${myComputerIp}. You can continue.` }
          : { ok: false, text: 'That didn\'t complete. Did you approve the Windows permission (UAC) prompt? You can try again, or set it manually using the steps below.' },
      )
    } catch (ex: any) {
      setIpResult({ ok: false, text: ex?.message ?? String(ex) })
    } finally {
      setIpApplying(false)
    }
  }

  async function resetMyIpToDhcp() {
    if (!adapter) return
    setIpApplying(true)
    setIpResult(null)
    try {
      const ok = await window.api.network.applyDhcp(adapter)
      setIpResult(
        ok
          ? { ok: true, text: `"${adapter}" is back to automatic (DHCP).` }
          : { ok: false, text: 'That didn\'t complete (the Windows permission prompt may have been declined).' },
      )
    } finally {
      setIpApplying(false)
    }
  }

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

  const activeSteps = SETUP_STEP_LABELS.filter((_, i) => steps[i])

  return (
    <div className="wizard">
      <div className="wizard-head">
        <h2 style={{ marginTop: 0 }}>Set up a new site</h2>
        {stage !== 'running' && stage !== 'result' && (
          <button onClick={onCancel}>Cancel</button>
        )}
      </div>

      <Stepper steps={stepperLabels} current={currentStepIndex} />

      {/* STEP 1 — Name the site */}
      {stage === 'name' && (
        <div className="panel">
          <h3 className="step-title">Name this site</h3>
          <p className="muted">Give the site a short, recognisable name. We'll pick sensible network settings for you.</p>
          <div className="field">
            <label>Site name</label>
            <input
              value={siteName}
              onChange={(e) => setSiteName(e.target.value)}
              placeholder="e.g. Riverland"
              autoFocus
            />
          </div>

          {lanThird > 0 && (
            <div className="banner info">
              This site will use network <code>192.168.{lanThird}.x</code>. The router will be{' '}
              <code>{mikroTikLanIp}</code> and the camera/NVR will be <code>{deviceIp}</code>. You don't need to change
              anything unless you have a reason to.
            </div>
          )}

          <Collapsible summary="Advanced settings (network addresses)">
            <p className="muted">
              These are auto-filled to the next free values. Only change them if you know they clash with another site.
            </p>
            <div className="row">
              <div className="field">
                <label>WireGuard (VPN) IP for this site</label>
                <input value={wgIp} onChange={(e) => setWgIp(e.target.value)} />
              </div>
              <div className="field">
                <label>LAN network (the X in 192.168.X.0)</label>
                <input
                  type="number"
                  value={lanThird}
                  onChange={(e) => setLanThird(parseInt(e.target.value, 10) || 0)}
                />
              </div>
            </div>
          </Collapsible>

          <div className="actions">
            <button className="primary" onClick={proceedFromName} disabled={!siteName.trim() || !lanThird}>
              Next →
            </button>
          </div>
        </div>
      )}

      {/* STEP 2 — Connect to the router */}
      {stage === 'connect' && (
        <div className="panel">
          {nameWarning && <div className="banner warn">{nameWarning}</div>}
          {subnetWarning && <div className="banner warn">{subnetWarning}</div>}
          <h3 className="step-title">Connect to the router</h3>
          <p className="muted">
            Make sure your computer is plugged into one of the router's LAN ports. New routers answer at{' '}
            <code>192.168.88.1</code> with username <code>admin</code> and a blank password.
          </p>
          {detecting && <p className="muted">Looking for your router…</p>}
          <div className="row">
            <div className="field">
              <label>Router's current address</label>
              <input value={routerIp} onChange={(e) => setRouterIp(e.target.value)} placeholder="192.168.88.1" />
            </div>
            <div className="field">
              <label>Username</label>
              <input value={username} onChange={(e) => setUsername(e.target.value)} />
            </div>
            <div className="field">
              <label>Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
          </div>
          <div className="actions">
            <button onClick={() => setStage('name')}>← Back</button>
            <button className="primary" onClick={afterConnect} disabled={!routerIp}>
              Next →
            </button>
          </div>
          <p className="muted" style={{ fontSize: 12 }}>
            We'll connect when you press Start on the review screen, so you can fix the address here if it's wrong.
          </p>
        </div>
      )}

      {/* STEP 3 — Prepare this computer (only when the LAN IP will change) */}
      {stage === 'prepComputer' && (
        <div className="panel">
          <h3 className="step-title">Prepare your computer</h3>
          <p>
            During setup the router's address changes to <code>{mikroTikLanIp}</code>. For your computer to keep
            talking to it, your network adapter needs a matching address. We can set this for you:
          </p>
          <div className="field">
            <label>Which network adapter is plugged into the router?</label>
            <select value={adapter} onChange={(e) => setAdapter(e.target.value)} disabled={ipApplying}>
              {adapters.length === 0 && <option value="">No adapters found</option>}
              {adapters.map((a) => (
                <option key={a.name} value={a.name}>
                  {a.name} ({a.kind})
                </option>
              ))}
            </select>
          </div>
          <p className="muted">
            This sets <code>{adapter || 'your adapter'}</code> to IP <code>{myComputerIp}</code>, gateway{' '}
            <code>{mikroTikLanIp}</code>. Windows will ask for permission — approve it.
          </p>
          <div className="actions">
            <button className="primary" onClick={applyMyIp} disabled={ipApplying || !adapter}>
              {ipApplying ? 'Setting…' : '⚙ Set my computer\'s IP automatically'}
            </button>
          </div>
          {ipResult && (
            <div className={`banner ${ipResult.ok ? 'success' : 'warn'}`} style={{ marginTop: 12 }}>
              {ipResult.text}
            </div>
          )}

          <Collapsible summary="Prefer to set it yourself? Manual steps">
            <p className="muted">In Windows Settings → Network &amp; Internet → your Ethernet adapter, set:</p>
            <ul>
              <li>IP address: <code>{myComputerIp}</code></li>
              <li>Subnet mask: <code>255.255.255.0</code></li>
              <li>Gateway: <code>{mikroTikLanIp}</code></li>
              <li>DNS: <code>8.8.8.8</code></li>
            </ul>
          </Collapsible>

          <div className="actions" style={{ marginTop: 12 }}>
            <button onClick={() => setStage('connect')}>← Back</button>
            <button className="primary" onClick={() => setStage('review')}>
              {ipResult?.ok ? 'Next →' : 'My computer is ready — Next →'}
            </button>
          </div>
        </div>
      )}

      {/* STEP 4 — Review & start */}
      {stage === 'review' && (
        <div className="panel">
          <h3 className="step-title">Review &amp; start</h3>
          <p className="muted">Here's what will happen. When you're ready, press Start.</p>

          <div className="summary-grid">
            <div className="summary-label">Site name</div>
            <div>{siteName}</div>
            <div className="summary-label">Site network</div>
            <div><code>192.168.{lanThird}.x</code></div>
            <div className="summary-label">Router will become</div>
            <div><code>{mikroTikLanIp}</code></div>
            <div className="summary-label">Camera / NVR address</div>
            <div><code>{deviceIp}</code></div>
            <div className="summary-label">VPN (WireGuard) IP</div>
            <div><code>{wgIp}</code></div>
            <div className="summary-label">Connecting to</div>
            <div><code>{routerIp}</code> as <code>{username}</code></div>
          </div>

          <div className="banner info">
            {activeSteps.length} of {SETUP_STEP_LABELS.length} setup tasks will run, then the app verifies each one
            automatically. This usually takes a minute or two.
          </div>

          <Collapsible summary="Advanced: choose exactly which tasks run">
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
                The firewall/NAT/watchdog tasks assume the WireGuard tunnel already exists (you've unticked "Configure
                WireGuard tunnel"). Make sure that's true.
              </div>
            )}
          </Collapsible>

          <div className="actions">
            <button onClick={() => setStage(changesBridge ? 'prepComputer' : 'connect')}>← Back</button>
            <button className="primary" onClick={run} disabled={!routerIp}>
              ▶ Start setup
            </button>
          </div>
        </div>
      )}

      {/* Running / result — live progress */}
      {(stage === 'running' || stage === 'result') && (
        <div className="panel">
          <h3 className="step-title">{running ? 'Setting up…' : stage === 'result' ? 'Setup finished' : ''}</h3>
          {running && (
            <p className="muted">
              Working through the setup tasks now — please don't unplug or close the app. Live details are below.
            </p>
          )}
          <div className="run-steps">
            {activeSteps.map((label) => (
              <div key={label} className="run-step">
                <span className="run-step-mark">{running ? '•' : '✓'}</span>
                {label}
              </div>
            ))}
          </div>
          <Collapsible summary="Show technical details (live router output)" defaultOpen={running}>
            <LogConsole resetKey={resetKey} />
          </Collapsible>
        </div>
      )}

      {/* Result actions */}
      {stage === 'result' && result && (
        <div className="panel">
          <div className={`banner ${result.ok ? 'success' : 'error'}`}>
            {result.ok
              ? '✓ Setup completed. A couple of quick things left to finish below.'
              : `Setup finished with issues: ${result.message ?? ''} — check the technical details above.`}
          </div>

          {result.peerBlock && (
            <>
              <h3 className="step-title">1. Add this to the EC2 server's WireGuard config</h3>
              <p className="muted">
                Append this block to the server (KyospanServer) config. Don't remove or change any existing [Peer]
                sections.
              </p>
              <div className="copy-block">
                <pre className="console" style={{ whiteSpace: 'pre' }}>{result.peerBlock}</pre>
                <CopyButton value={result.peerBlock} className="primary" label="Copy peer block" />
              </div>
            </>
          )}

          <h3 className="step-title">{result.peerBlock ? '2. ' : ''}Set up the Hikvision device</h3>
          <p className="muted">In the device's web page, set its network to:</p>
          <div className="summary-grid">
            <div className="summary-label">IP address</div>
            <div><code>{deviceIp}</code> <CopyButton value={deviceIp} label="Copy" /></div>
            <div className="summary-label">Subnet mask</div>
            <div><code>255.255.255.0</code></div>
            <div className="summary-label">Default gateway</div>
            <div><code>{mikroTikLanIp}</code> <CopyButton value={mikroTikLanIp} label="Copy" /></div>
            <div className="summary-label">DNS</div>
            <div><code>8.8.8.8</code></div>
            <div className="summary-label">NTP server</div>
            <div><code>pool.ntp.org</code></div>
            <div className="summary-label">SDK port</div>
            <div><code>8000</code> (leave default)</div>
          </div>

          {changesBridge && (
            <>
              <h3 className="step-title">{result.peerBlock ? '3. ' : ''}When you're done — restore your computer</h3>
              <p className="muted">
                You set your computer to a fixed IP earlier. Once everything's verified, put it back to automatic so
                normal internet works again.
              </p>
              <div className="actions">
                <button onClick={resetMyIpToDhcp} disabled={ipApplying || !adapter}>
                  {ipApplying ? 'Restoring…' : '↺ Reset my computer to automatic (DHCP)'}
                </button>
              </div>
              {ipResult && (
                <div className={`banner ${ipResult.ok ? 'success' : 'warn'}`} style={{ marginTop: 12 }}>
                  {ipResult.text}
                </div>
              )}
            </>
          )}

          <div className="actions" style={{ marginTop: 16 }}>
            <button className="primary" onClick={onFinished}>
              Finish — go to my sites
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
