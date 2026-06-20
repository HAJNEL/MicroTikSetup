import React, { useEffect, useMemo, useState } from 'react'
import { SiteRecord, NextSiteSuggestion } from '../types'
import SiteDetail from './SiteDetail'

interface Props {
  refreshToken: number
  onSitesChanged: () => void
  onNewSite: () => void
}

export default function SitesPage({ refreshToken, onSitesChanged, onNewSite }: Props) {
  const [sites, setSites] = useState<SiteRecord[]>([])
  const [selected, setSelected] = useState<SiteRecord | null>(null)
  const [suggestion, setSuggestion] = useState<NextSiteSuggestion | null>(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')

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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sites
    return sites.filter(
      (s) => s.siteName.toLowerCase().includes(q) || s.lanSubnet.includes(q) || s.deviceIp.includes(q),
    )
  }, [sites, query])

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
      <div className="page-head">
        <div>
          <h2 style={{ margin: 0 }}>Your sites</h2>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Tap a site to view its details, recover its VPN, or get its WireGuard config.
          </p>
        </div>
        <button className="primary" onClick={onNewSite}>
          ➕ Set up a new site
        </button>
      </div>

      <div className="panel">
        {loading ? (
          <p className="muted">Loading…</p>
        ) : sites.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📍</div>
            <h3 style={{ margin: '0 0 6px' }}>No sites yet</h3>
            <p className="muted" style={{ marginTop: 0 }}>
              Once you set up a router, it'll be saved here so you can manage it later.
            </p>
            <button className="primary" onClick={onNewSite}>
              ➕ Set up your first site
            </button>
          </div>
        ) : (
          <>
            <input
              className="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, network or device IP…"
            />
            {filtered.length === 0 ? (
              <p className="muted">No sites match “{query}”.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Site</th>
                    <th>VPN IP</th>
                    <th>Network</th>
                    <th>Device IP</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s) => (
                    <tr key={s.siteName} className="clickable" onClick={() => setSelected(s)}>
                      <td>{s.siteName}</td>
                      <td>{s.wireGuardIp}</td>
                      <td>{s.lanSubnet}</td>
                      <td>{s.deviceIp}</td>
                      <td className="muted">View →</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>

      {suggestion && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Ready for the next site</h3>
          <p className="muted">
            The next free settings are <code>192.168.{suggestion.lanThirdOctet}.x</code> with VPN IP{' '}
            <code>10.10.0.{suggestion.wgOctet}</code>. The setup wizard fills these in for you automatically.
          </p>
          <div className="actions">
            <button className="primary" onClick={onNewSite}>
              ➕ Set up the next site
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
