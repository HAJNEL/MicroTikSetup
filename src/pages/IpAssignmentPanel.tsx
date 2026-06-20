import React, { useEffect, useState } from 'react'
import { NetworkAdapterInfo, SiteRecord } from '../types'

interface Props {
  site: SiteRecord
}

export default function IpAssignmentPanel({ site }: Props) {
  const [adapters, setAdapters] = useState<NetworkAdapterInfo[]>([])
  const [selectedAdapter, setSelectedAdapter] = useState('')
  const [mode, setMode] = useState<'static' | 'dhcp'>('static')
  const [ip, setIp] = useState('')
  const [mask, setMask] = useState('255.255.255.0')
  const [gateway, setGateway] = useState('')
  const [dns, setDns] = useState('8.8.8.8')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  useEffect(() => {
    window.api.network.listAdapters().then((list) => {
      setAdapters(list)
      if (list.length > 0) setSelectedAdapter(list[0].name)
    })
    const thirdOctet = site.mikroTikLanIp.split('.')[2] ?? '2'
    setIp(`192.168.${thirdOctet}.2`)
    setGateway(site.mikroTikLanIp)
  }, [site])

  async function apply() {
    setBusy(true)
    setResult(null)
    try {
      if (mode === 'dhcp') {
        const ok = await window.api.network.applyDhcp(selectedAdapter)
        setResult(ok ? `"${selectedAdapter}" switched back to automatic (DHCP).` : 'The change did not complete (UAC prompt declined?).')
      } else {
        const ok = await window.api.network.applyStaticIp(selectedAdapter, ip, mask, gateway, dns)
        setResult(
          ok
            ? `"${selectedAdapter}" is now set to ${ip} / ${mask}, gateway ${gateway}, DNS ${dns}.`
            : 'The change did not complete (UAC prompt declined?).',
        )
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel">
      <h2>IP assignment setup (this computer)</h2>
      <p className="muted">
        Configures one of this computer's network adapters so you can connect directly to {site.siteName}'s router (
        {site.mikroTikLanIp}). Windows will show a UAC prompt — approve it to apply the change.
      </p>

      <div className="field">
        <label>Network adapter</label>
        <select value={selectedAdapter} onChange={(e) => setSelectedAdapter(e.target.value)} disabled={busy}>
          {adapters.length === 0 && <option value="">No adapters found</option>}
          {adapters.map((a) => (
            <option key={a.name} value={a.name}>
              {a.name} ({a.kind})
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label>Mode</label>
        <select value={mode} onChange={(e) => setMode(e.target.value as 'static' | 'dhcp')} disabled={busy}>
          <option value="static">Set a static IP for this site</option>
          <option value="dhcp">Switch back to automatic (DHCP)</option>
        </select>
      </div>

      {mode === 'static' && (
        <>
          <div className="row">
            <div className="field">
              <label>Static IP address</label>
              <input value={ip} onChange={(e) => setIp(e.target.value)} disabled={busy} />
            </div>
            <div className="field">
              <label>Subnet mask</label>
              <input value={mask} onChange={(e) => setMask(e.target.value)} disabled={busy} />
            </div>
          </div>
          <div className="row">
            <div className="field">
              <label>Default gateway</label>
              <input value={gateway} onChange={(e) => setGateway(e.target.value)} disabled={busy} />
            </div>
            <div className="field">
              <label>Preferred DNS server</label>
              <input value={dns} onChange={(e) => setDns(e.target.value)} disabled={busy} />
            </div>
          </div>
        </>
      )}

      <div className="actions">
        <button className="primary" onClick={apply} disabled={busy || !selectedAdapter}>
          {busy ? 'Applying...' : 'Apply'}
        </button>
      </div>

      {result && <div className="banner success" style={{ marginTop: 14 }}>{result}</div>}
    </div>
  )
}
