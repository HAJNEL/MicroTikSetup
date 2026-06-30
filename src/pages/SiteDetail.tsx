import React, { useState } from 'react'
import {
  SiteRecord,
  SshCredentials,
  SetupPlan,
  SETUP_STEP_LABELS,
  STEP_CHANGE_BRIDGE_IP,
  CheckResult,
  NetworkAdapterInfo,
  BRIDGE_IP_CHECK_NAME,
} from '../types'
import SshActionPanel from './SshActionPanel'
import IpAssignmentPanel from './IpAssignmentPanel'
import CredentialsForm from '../components/CredentialsForm'
import LogConsole from '../components/LogConsole'
import Collapsible from '../components/Collapsible'
import BridgeIpWarning from '../components/BridgeIpWarning'

type Tab =
  | 'details'
  | 'peer'
  | 'ipAssignment'
  | 'configCheck'
  | 'rerunSetup'
  | 'fixBridgeIp'
  | 'recover'
  | 'watchdog'
  | 'remoteSupport'
  | 'edit'

const TABS: { id: Tab; icon: string; label: string }[] = [
  { id: 'details',       icon: '◉',  label: 'Details'        },
  { id: 'peer',          icon: '⛓',  label: 'Peer Config'    },
  { id: 'ipAssignment',  icon: '🌐', label: 'IP Setup'       },
  { id: 'configCheck',   icon: '⟳',  label: 'Config Check'   },
  { id: 'rerunSetup',    icon: '⚙',  label: 'Run Setup'      },
  { id: 'fixBridgeIp',   icon: '⌂',  label: 'Fix Bridge IP'  },
  { id: 'recover',       icon: '↺',  label: 'Recover VPN'    },
  { id: 'watchdog',      icon: '🛡', label: 'Watchdog'       },
  { id: 'remoteSupport', icon: '🔧', label: 'Remote Support' },
  { id: 'edit',          icon: '✏',  label: 'Edit'           },
]

interface Props {
  site: SiteRecord
  onBack: () => void
  onUpdated: (updated: SiteRecord) => void
  onDeleted: () => void
}

export default function SiteDetail({ site, onBack, onUpdated, onDeleted }: Props) {
  const [tab, setTab] = useState<Tab>('details')
  const [mask, setMask] = useState<string>('')

  React.useEffect(() => {
    window.api.sites.subnetMask(site.lanSubnet).then(setMask)
  }, [site.lanSubnet])

  return (
    <div>
      <div className="back-row">
        <button type="button" onClick={onBack}>&larr; Back to site list</button>
        <IpToggle site={site} />
      </div>

      <div className="panel">
        <h2 className="site-panel-title">{site.siteName}</h2>

        <div className="site-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`site-tab-btn ${tab === t.id ? 'primary' : ''}`}
              onClick={() => setTab(t.id)}
            >
              <span className="site-tab-icon">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>

        <div className="site-tab-footer">
          <button
            type="button"
            className="danger site-tab-delete"
            onClick={async () => {
              if (!confirm(`Delete site '${site.siteName}'? This cannot be undone.`)) return
              onDeleted()
            }}
          >
            <span className="site-tab-icon">🗑</span>
            Delete site
          </button>
        </div>
      </div>

      {tab === 'details' && (
        <div className="panel">
          <h2>General</h2>
          <p>
            <span className="muted">Date configured:</span> {site.dateConfigured || '—'}
          </p>
          <h2>WireGuard</h2>
          <p>
            <span className="muted">WireGuard IP:</span> <code>{site.wireGuardIp}</code>
          </p>
          <p>
            <span className="muted">MikroTik public key:</span>{' '}
            <code>{site.mikroTikPublicKey || '(none — run a Config Check to read it from the router)'}</code>
          </p>
          <h2>Device config (set these in the device's network settings)</h2>
          <p>
            <span className="muted">IP address:</span> <code>{site.deviceIp}</code>
          </p>
          <p>
            <span className="muted">Subnet mask:</span> <code>{mask}</code>
          </p>
          <p>
            <span className="muted">Default gateway:</span> <code>{site.deviceGateway}</code>
          </p>
          <p>
            <span className="muted">Preferred DNS server:</span> <code>8.8.8.8</code>
          </p>
          <p>
            <span className="muted">Alternative DNS server:</span> <code>8.8.4.4</code>
          </p>
          <CheckResultsSection lastCheckResults={site.lastCheckResults} mikroTikLanIp={site.mikroTikLanIp} />
        </div>
      )}

      {tab === 'peer' && (
        <div className="panel">
          <h2>WireGuard peer config</h2>
          <p className="muted">Copy this into the EC2 server's WireGuard (KyospanServer) config.</p>
          {site.mikroTikPublicKey ? (
            <pre className="console pre-exact">
{`#${site.siteName}
[Peer]
PublicKey = ${site.mikroTikPublicKey}
AllowedIPs = ${site.wireGuardIp}/32, ${site.lanSubnet}`}
            </pre>
          ) : (
            <p className="muted">
              No MikroTik public key recorded — run a{' '}
              <button type="button" className="inline-link-btn" onClick={() => setTab('configCheck')}>
                Config Check
              </button>{' '}
              to read it from the router.
            </p>
          )}
        </div>
      )}

      {tab === 'ipAssignment' && <IpAssignmentPanel site={site} />}

      {tab === 'configCheck' && <ConfigCheckPanel site={site} onSiteUpdated={onUpdated} />}

      {tab === 'rerunSetup' && <RerunSetupPanel site={site} onSiteUpdated={onUpdated} />}

      {tab === 'fixBridgeIp' && <FixBridgeIpPanel site={site} />}

      {tab === 'recover' && (
        <SshActionPanel
          site={site}
          title="Recover VPN tunnel"
          description="Bounces the WireGuard peer to force the tunnel to reconnect, which brings the site's scanner back online in HikCentral. No other router config is changed."
          confirmLabel="Connect and bounce the WireGuard peer"
          run={(creds) => window.api.workflow.recoverTunnel(creds)}
        />
      )}

      {tab === 'watchdog' && (
        <SshActionPanel
          site={site}
          title="Add VPN-recovery watchdog"
          description="Adds (or refreshes) the scheduler that automatically re-establishes the WireGuard tunnel whenever the LTE link drops and reconnects. Does not change any other config."
          confirmLabel="Connect and add the watchdog"
          run={(creds) => window.api.workflow.addWatchdog(creds)}
        />
      )}

      {tab === 'remoteSupport' && (
        <SshActionPanel
          site={site}
          title="Enable remote support"
          description="Enables MikroTik Cloud DDNS + RoMON, adds a firewall rule that guarantees management over the WireGuard tunnel, and disables unused services to harden the router. SSH, WinBox and WebFig (browser) stay enabled."
          confirmLabel="Connect and enable remote support"
          run={(creds) => window.api.workflow.enableRemoteSupport(creds)}
        />
      )}

      {tab === 'edit' && (
        <EditSiteForm
          site={site}
          onSaved={(updated) => {
            onUpdated(updated)
            setTab('details')
          }}
        />
      )}
    </div>
  )
}

function ConfigCheckPanel({ site, onSiteUpdated }: { site: SiteRecord; onSiteUpdated: (s: SiteRecord) => void }) {
  const [creds, setCreds] = useState<SshCredentials>({
    routerIp: site.mikroTikLanIp || '192.168.88.1',
    username: 'admin',
    password: '',
  })
  const [running, setRunning] = useState(false)
  const [resetKey, setResetKey] = useState(0)
  const [result, setResult] = useState<{
    ok: boolean
    message?: string
    mikroTikPublicKey?: string
    updatedSite?: SiteRecord
    checkResults?: CheckResult[]
  } | null>(null)

  async function run() {
    setResetKey((k) => k + 1)
    setResult(null)
    setRunning(true)
    try {
      const res = await window.api.workflow.configCheck(site.siteName, creds)
      setResult(res)
      if (res.updatedSite) onSiteUpdated(res.updatedSite)
    } catch (ex: any) {
      setResult({ ok: false, message: ex?.message ?? String(ex) })
    } finally {
      setRunning(false)
    }
  }

  const bridgeIpFailed = result?.checkResults?.some((r) => r.name === BRIDGE_IP_CHECK_NAME && !r.passed)

  return (
    <div className="panel">
      <h2>Config Check</h2>
      <p className="muted">
        Connects to the router and reads the current configuration — WireGuard interface, peers, IP addresses, firewall
        rules, and watchdog scheduler. If the public key is missing from this site's record, it will be saved
        automatically.
      </p>
      <CredentialsForm value={creds} onChange={setCreds} disabled={running} />
      <div className="actions">
        <button type="button" className="primary" onClick={run} disabled={running || !creds.routerIp || !creds.password}>
          {running ? 'Reading…' : '⟳ Run config check'}
        </button>
      </div>
      {result && (
        <div className={`banner banner-result ${result.ok ? 'success' : 'error'}`}>
          {result.ok
            ? result.mikroTikPublicKey
              ? '✓ Config read. Public key found and saved to site record.'
              : '✓ Config read. No WireGuard public key found on the router.'
            : `Failed: ${result.message ?? 'unknown error'}`}
        </div>
      )}
      {bridgeIpFailed && <BridgeIpWarning mikroTikLanIp={site.mikroTikLanIp} />}
      {result?.checkResults && result.checkResults.length > 0 && (
        <div className="check-results">
          {result.checkResults.map((cr) => (
            <div key={cr.name} className="check-item">
              <span className={`check-mark ${cr.passed ? 'pass' : 'fail'}`}>{cr.passed ? '✓' : '✗'}</span>
              <span className={`check-name${cr.passed ? '' : ' fail'}`}>{cr.name}</span>
            </div>
          ))}
        </div>
      )}
      <div className="log-area">
        <LogConsole resetKey={resetKey} />
      </div>
    </div>
  )
}

function RerunSetupPanel({ site, onSiteUpdated }: { site: SiteRecord; onSiteUpdated: (s: SiteRecord) => void }) {
  const lanThirdOctet = parseInt(site.lanSubnet.split('.')[2] ?? '0', 10)

  const [creds, setCreds] = useState<SshCredentials>({
    routerIp: site.mikroTikLanIp || '192.168.88.1',
    username: 'admin',
    password: '',
  })
  const [steps, setSteps] = useState<boolean[]>(SETUP_STEP_LABELS.map((_, i) => i !== STEP_CHANGE_BRIDGE_IP))
  const [running, setRunning] = useState(false)
  const [resetKey, setResetKey] = useState(0)
  const [result, setResult] = useState<{
    ok: boolean
    message?: string
    site?: SiteRecord
    checkResults?: CheckResult[]
  } | null>(null)

  function toggleStep(i: number) {
    setSteps((prev) => prev.map((v, idx) => (idx === i ? !v : v)))
  }

  async function run() {
    setResetKey((k) => k + 1)
    setResult(null)
    setRunning(true)

    const plan: SetupPlan = {
      siteName: site.siteName,
      wireGuardIp: site.wireGuardIp,
      lanThirdOctet,
      currentRouterIp: creds.routerIp,
      username: creds.username,
      password: creds.password,
      steps,
    }

    try {
      const res = await window.api.workflow.runSetup(plan)
      setResult(res)
      if (res.site) onSiteUpdated(res.site)
    } catch (ex: any) {
      setResult({ ok: false, message: ex?.message ?? String(ex) })
    } finally {
      setRunning(false)
    }
  }

  const activeCount = steps.filter(Boolean).length
  const bridgeIpFailed = result?.checkResults?.some((r) => r.name === BRIDGE_IP_CHECK_NAME && !r.passed)

  return (
    <div className="panel">
      <h2>Run Setup Again</h2>
      <p className="muted">
        Re-runs the setup workflow against this router using the site's saved settings. Enter the router password, choose
        which tasks to run, then press Start. "Change bridge/LAN IP" is off by default — that is a one-time step already
        done during initial setup.
      </p>
      <CredentialsForm value={creds} onChange={setCreds} disabled={running} />
      <Collapsible summary="Choose which tasks to run">
        <div className="checklist">
          {SETUP_STEP_LABELS.map((label, i) => (
            <label key={i}>
              <input type="checkbox" checked={steps[i]} onChange={() => toggleStep(i)} disabled={running} />
              {label}
            </label>
          ))}
        </div>
      </Collapsible>
      <div className="actions-top">
        <button
          type="button"
          className="primary"
          onClick={run}
          disabled={running || !creds.routerIp || !creds.password || activeCount === 0}
        >
          {running ? 'Running…' : `▶ Start (${activeCount} task${activeCount === 1 ? '' : 's'})`}
        </button>
      </div>
      {result && (
        <div className={`banner banner-result ${result.ok ? 'success' : 'error'}`}>
          {result.ok
            ? '✓ Setup completed successfully.'
            : `Setup failed: ${result.message ?? 'unknown error'} — see the log above for details.`}
        </div>
      )}
      {bridgeIpFailed && <BridgeIpWarning mikroTikLanIp={site.mikroTikLanIp} />}
      {result?.checkResults && result.checkResults.length > 0 && (
        <div className="check-results">
          {result.checkResults.map((cr) => (
            <div key={cr.name} className="check-item">
              <span className={`check-mark ${cr.passed ? 'pass' : 'fail'}`}>{cr.passed ? '✓' : '✗'}</span>
              <span className={`check-name${cr.passed ? '' : ' fail'}`}>{cr.name}</span>
            </div>
          ))}
        </div>
      )}
      <div className="log-area">
        <LogConsole resetKey={resetKey} />
      </div>
    </div>
  )
}

function IpToggle({ site }: { site: SiteRecord }) {
  const [adapters, setAdapters] = useState<NetworkAdapterInfo[]>([])
  const [adapter, setAdapter] = useState('')
  const [mode, setMode] = useState<'dhcp' | 'static'>('dhcp')
  const [checking, setChecking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)

  React.useEffect(() => {
    window.api.network.listAdapters().then((list) => {
      setAdapters(list)
      const preferred = list.find((a) => a.kind === 'Ethernet') ?? list[0]
      if (preferred) setAdapter(preferred.name)
    })
  }, [])

  React.useEffect(() => {
    if (!adapter) return
    setChecking(true)
    setMsg(null)
    window.api.network.getAdapterMode(adapter).then((m) => {
      setMode(m)
      setChecking(false)
    })
  }, [adapter])

  const thirdOctet = site.mikroTikLanIp.split('.')[2] ?? '0'
  const staticIp = `192.168.${thirdOctet}.2`

  async function toggle() {
    if (!adapter) return
    setBusy(true)
    setMsg(null)
    try {
      if (mode === 'dhcp') {
        const ok = await window.api.network.applyStaticIp(adapter, staticIp, '255.255.255.0', site.mikroTikLanIp, '8.8.8.8')
        if (ok) { setMode('static'); setMsg({ text: `Static: ${staticIp}`, ok: true }) }
        else setMsg({ text: 'UAC prompt declined', ok: false })
      } else {
        const ok = await window.api.network.applyDhcp(adapter)
        if (ok) { setMode('dhcp'); setMsg({ text: 'Restored to DHCP', ok: true }) }
        else setMsg({ text: 'UAC prompt declined', ok: false })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ip-toggle">
      <select className="ip-toggle-adapter" aria-label="Network adapter" value={adapter} onChange={(e) => setAdapter(e.target.value)} disabled={busy}>
        {adapters.map((a) => (
          <option key={a.name} value={a.name}>{a.name}</option>
        ))}
      </select>
      <button type="button" className={mode === 'dhcp' ? 'primary' : ''} onClick={toggle} disabled={busy || checking || !adapter}>
        {checking ? 'Checking…' : busy ? 'Applying…' : mode === 'dhcp' ? '📡 Set Static IP' : '↩ Restore DHCP'}
      </button>
      {msg && <span className={`ip-toggle-msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</span>}
    </div>
  )
}

function FixBridgeIpPanel({ site }: { site: SiteRecord }) {
  const [currentIp, setCurrentIp] = useState('192.168.88.1')
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [running, setRunning] = useState(false)
  const [resetKey, setResetKey] = useState(0)
  const [result, setResult] = useState<{ ok: boolean; message?: string } | null>(null)

  async function run() {
    setResetKey((k) => k + 1)
    setResult(null)
    setRunning(true)
    try {
      const res = await window.api.workflow.fixBridgeIp(currentIp, { routerIp: currentIp, username, password }, site.mikroTikLanIp)
      setResult(res)
    } catch (ex: any) {
      setResult({ ok: false, message: ex?.message ?? String(ex) })
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="panel">
      <h2>Fix Bridge IP</h2>
      <p className="muted">
        Sets the router's bridge/LAN IP to <code>{site.mikroTikLanIp}</code> — the address this site expects. Use this
        when the router is still on the factory default (<code>192.168.88.1</code>) and devices on the LAN have no
        internet because the NAT, firewall, and WireGuard rules are all configured for the new subnet.
      </p>
      <div className="banner info">
        If you can't reach the router by IP, connect via WinBox → Neighbors tab → click the MAC address, then set
        your computer to a static IP on the same subnet as the current router address before running this.
      </div>
      <div className="field">
        <label htmlFor="fbip-current-ip">Router's <strong>current</strong> IP address</label>
        <input
          id="fbip-current-ip"
          value={currentIp}
          onChange={(e) => setCurrentIp(e.target.value)}
          disabled={running}
          placeholder="192.168.88.1"
        />
      </div>
      <div className="row">
        <div className="field">
          <label htmlFor="fbip-username">Username</label>
          <input id="fbip-username" value={username} onChange={(e) => setUsername(e.target.value)} disabled={running} />
        </div>
        <div className="field">
          <label htmlFor="fbip-password">Password</label>
          <input id="fbip-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={running} />
        </div>
      </div>
      <div className="summary-grid">
        <div className="summary-label">Will change bridge to</div>
        <div><code>{site.mikroTikLanIp}/24</code></div>
      </div>
      <div className="actions-top">
        <button
          type="button"
          className="primary"
          onClick={run}
          disabled={running || !currentIp || !password}
        >
          {running ? 'Applying…' : `⌂ Set bridge IP to ${site.mikroTikLanIp}`}
        </button>
      </div>
      {result && (
        <div className={`banner banner-result ${result.ok ? 'success' : 'error'}`}>
          {result.ok
            ? `✓ Bridge IP is now ${site.mikroTikLanIp}/24. Devices on the LAN should now have internet.`
            : `Failed: ${result.message ?? 'unknown error'}`}
        </div>
      )}
      <div className="log-area">
        <LogConsole resetKey={resetKey} />
      </div>
    </div>
  )
}

function CheckResultsSection({
  lastCheckResults,
  mikroTikLanIp,
}: {
  lastCheckResults?: string
  mikroTikLanIp: string
}) {
  if (!lastCheckResults) return null
  let results: CheckResult[]
  try {
    results = JSON.parse(lastCheckResults) as CheckResult[]
  } catch {
    return null
  }
  if (!results.length) return null
  const failCount = results.filter((r) => !r.passed).length
  const bridgeIpFailed = results.some((r) => r.name === BRIDGE_IP_CHECK_NAME && !r.passed)
  return (
    <>
      <h2>Last verification results</h2>
      {bridgeIpFailed && <BridgeIpWarning mikroTikLanIp={mikroTikLanIp} />}
      <div className="check-results">
        {results.map((r, i) => (
          <div key={i} className="check-item">
            <span className={`check-mark ${r.passed ? 'pass' : 'fail'}`}>{r.passed ? '✓' : '✗'}</span>
            <span className={`check-name${r.passed ? '' : ' fail'}`}>{r.name}</span>
          </div>
        ))}
      </div>
      <p className="muted">
        {failCount === 0
          ? `All ${results.length} checks passed.`
          : `${failCount} of ${results.length} checks failed.`}
      </p>
    </>
  )
}

function EditSiteForm({ site, onSaved }: { site: SiteRecord; onSaved: (s: SiteRecord) => void }) {
  const [form, setForm] = useState<SiteRecord>({ ...site })
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      await window.api.sites.update(site.siteName, form)
      onSaved(form)
    } finally {
      setSaving(false)
    }
  }

  const field = (label: string, key: keyof SiteRecord) => (
    <div className="field">
      <label htmlFor={`edit-field-${key}`}>{label}</label>
      <input
        id={`edit-field-${key}`}
        value={form[key] ?? ''}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        disabled={saving}
      />
    </div>
  )

  return (
    <div className="panel">
      <h2>Edit site</h2>
      {field('Site name', 'siteName')}
      <div className="row">
        {field('WireGuard IP', 'wireGuardIp')}
        {field('LAN subnet', 'lanSubnet')}
      </div>
      <div className="row">
        {field('MikroTik LAN IP', 'mikroTikLanIp')}
        {field('Device IP', 'deviceIp')}
      </div>
      <div className="row">
        {field('Device gateway', 'deviceGateway')}
        {field('MikroTik public key', 'mikroTikPublicKey')}
      </div>
      <div className="actions">
        <button type="button" className="primary" onClick={save} disabled={saving}>
          {saving ? 'Saving...' : 'Save changes'}
        </button>
      </div>
    </div>
  )
}
