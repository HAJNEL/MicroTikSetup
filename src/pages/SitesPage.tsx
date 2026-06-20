import React, { useEffect, useState } from 'react'
import { SiteRecord, NextSiteSuggestion } from '../types'
import SiteDetail from './SiteDetail'

interface Props {
  refreshToken: number
  onSitesChanged: () => void
}

export default function SitesPage({ refreshToken, onSitesChanged }: Props) {
  const [sites, setSites] = useState<SiteRecord[]>([])
  const [selected, setSelected] = useState<SiteRecord | null>(null)
  const [suggestion, setSuggestion] = useState<NextSiteSuggestion | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    Promise.all([window.api.sites.list(), window.api.sites.suggestNext()]).then(([list, sug]) => {
      setSites(list)
      setSuggestion(sug)
      setLoading(false)
      // keep selection in sync if it was edited/deleted elsewhere
      setSelected((prev) => (prev ? list.find((s) => s.siteName === prev.siteName) ?? null : null))
    })
  }, [refreshToken])

  if (selected) {
    return (
      <SiteDetail
        site={selected}
        onBack={() => setSelected(null)}
        onUpdated={(updated) => {
          setSelected(updated)
          onSitesChanged()
        }}
        onDeleted={async () => {
          await window.api.sites.delete(selected.siteName)
          setSelected(null)
          onSitesChanged()
        }}
      />
    )
  }

  return (
    <div>
      <div className="panel">
        <h2>Configured sites</h2>
        {loading ? (
          <p className="muted">Loading...</p>
        ) : sites.length === 0 ? (
          <p className="muted">No sites recorded yet. Use "New Site Setup" to configure one.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Site</th>
                <th>WG IP</th>
                <th>LAN subnet</th>
                <th>Device IP</th>
                <th>MikroTik public key</th>
              </tr>
            </thead>
            <tbody>
              {sites.map((s) => (
                <tr key={s.siteName} className="clickable" onClick={() => setSelected(s)}>
                  <td>{s.siteName}</td>
                  <td>{s.wireGuardIp}</td>
                  <td>{s.lanSubnet}</td>
                  <td>{s.deviceIp}</td>
                  <td>
                    <code>{truncateKey(s.mikroTikPublicKey)}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {suggestion && (
        <div className="panel">
          <h2>Suggested values for the next site</h2>
          <p>
            <span className="muted">WireGuard IP:</span> <code>10.10.0.{suggestion.wgOctet}</code>
          </p>
          <p>
            <span className="muted">LAN subnet:</span> <code>192.168.{suggestion.lanThirdOctet}.0/24</code>
          </p>
          <p>
            <span className="muted">MikroTik IP:</span> <code>192.168.{suggestion.lanThirdOctet}.1</code>
          </p>
          <p>
            <span className="muted">Device IP:</span> <code>192.168.{suggestion.lanThirdOctet}.200</code>
          </p>
        </div>
      )}
    </div>
  )
}

function truncateKey(key: string): string {
  if (!key) return '(none)'
  return key.length > 20 ? `${key.slice(0, 18)}…` : key
}
