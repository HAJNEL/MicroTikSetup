import React, { useState } from 'react'
import { SiteRecord } from '../types'
import SshActionPanel from './SshActionPanel'
import IpAssignmentPanel from './IpAssignmentPanel'

type Tab = 'details' | 'peer' | 'ipAssignment' | 'recover' | 'watchdog' | 'remoteSupport' | 'edit'

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
      <div className="actions" style={{ marginBottom: 16 }}>
        <button onClick={onBack}>&larr; Back to site list</button>
      </div>

      <div className="panel">
        <h2>{site.siteName}</h2>
        <div className="actions">
          <button className={tab === 'details' ? 'primary' : ''} onClick={() => setTab('details')}>
            View details
          </button>
          <button className={tab === 'peer' ? 'primary' : ''} onClick={() => setTab('peer')}>
            WireGuard peer config
          </button>
          <button className={tab === 'ipAssignment' ? 'primary' : ''} onClick={() => setTab('ipAssignment')}>
            IP assignment setup
          </button>
          <button className={tab === 'recover' ? 'primary' : ''} onClick={() => setTab('recover')}>
            Recover VPN tunnel
          </button>
          <button className={tab === 'watchdog' ? 'primary' : ''} onClick={() => setTab('watchdog')}>
            Add VPN-recovery watchdog
          </button>
          <button className={tab === 'remoteSupport' ? 'primary' : ''} onClick={() => setTab('remoteSupport')}>
            Enable remote support
          </button>
          <button className={tab === 'edit' ? 'primary' : ''} onClick={() => setTab('edit')}>
            Edit
          </button>
          <button
            className="danger"
            onClick={async () => {
              if (!confirm(`Delete site '${site.siteName}'? This cannot be undone.`)) return
              onDeleted()
            }}
          >
            Delete
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
            <span className="muted">MikroTik public key:</span> <code>{site.mikroTikPublicKey || '(none recorded)'}</code>
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
        </div>
      )}

      {tab === 'peer' && (
        <div className="panel">
          <h2>WireGuard peer config</h2>
          <p className="muted">Copy this into the EC2 server's WireGuard (KyospanServer) config.</p>
          {site.mikroTikPublicKey ? (
            <pre className="console" style={{ whiteSpace: 'pre' }}>
{`#${site.siteName}
[Peer]
PublicKey = ${site.mikroTikPublicKey}
AllowedIPs = ${site.wireGuardIp}/32, ${site.lanSubnet}`}
            </pre>
          ) : (
            <p className="muted">No MikroTik public key recorded for this site — cannot generate the [Peer] block.</p>
          )}
        </div>
      )}

      {tab === 'ipAssignment' && <IpAssignmentPanel site={site} />}

      {tab === 'recover' && (
        <SshActionPanel
          site={site}
          title="Recover VPN tunnel now"
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
      <label>{label}</label>
      <input value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} disabled={saving} />
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
        <button className="primary" onClick={save} disabled={saving}>
          {saving ? 'Saving...' : 'Save changes'}
        </button>
      </div>
    </div>
  )
}
