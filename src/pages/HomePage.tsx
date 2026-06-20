import React from 'react'

interface Props {
  siteCount: number | null
  onNewSite: () => void
  onManageSites: () => void
  onWifi: () => void
}

export default function HomePage({ siteCount, onNewSite, onManageSites, onWifi }: Props) {
  return (
    <div className="home">
      <h2 style={{ marginTop: 0 }}>What would you like to do?</h2>
      <p className="muted">
        This tool sets up MikroTik LTE routers for HikCentral camera sites. Pick a task below — each one walks you
        through it step by step.
      </p>

      <div className="card-grid">
        <button className="action-card primary-card" onClick={onNewSite}>
          <span className="action-icon">➕</span>
          <span className="action-title">Set up a new site</span>
          <span className="action-desc">
            Configure a brand-new router from scratch — VPN tunnel, firewall, internet and all. Recommended for a
            fresh router straight out of the box.
          </span>
          <span className="action-go">Start setup →</span>
        </button>

        <button className="action-card" onClick={onManageSites}>
          <span className="action-icon">📍</span>
          <span className="action-title">Manage existing sites</span>
          <span className="action-desc">
            View your {siteCount === null ? '' : `${siteCount} `}saved site{siteCount === 1 ? '' : 's'}, recover a
            dropped VPN, get a site's WireGuard details, or set your computer's IP to connect.
          </span>
          <span className="action-go">Open sites →</span>
        </button>

        <button className="action-card" onClick={onWifi}>
          <span className="action-icon">📶</span>
          <span className="action-title">Change WiFi name &amp; password</span>
          <span className="action-desc">
            Rename a router's WiFi network or update its password. Handy on a site visit when the WiFi needs
            changing.
          </span>
          <span className="action-go">Change WiFi →</span>
        </button>
      </div>

      <div className="banner" style={{ marginTop: 8 }}>
        <strong>Before you start a new site:</strong> plug your computer into one of the router's LAN ports (not the
        internet/WAN port) with an Ethernet cable, and make sure the router is powered on.
      </div>
    </div>
  )
}
