import React, { useState } from 'react'
import SitesPage from './pages/SitesPage'
import NewSiteWizard from './pages/NewSiteWizard'
import WifiPage from './pages/WifiPage'
import { SiteRecord } from './types'

type Page = { name: 'sites' } | { name: 'newSite' } | { name: 'wifi' }

export default function App() {
  const [page, setPage] = useState<Page>({ name: 'sites' })
  const [refreshToken, setRefreshToken] = useState(0)

  return (
    <div className="app-shell">
      <div className="sidebar">
        <h1>HikCentral Site Setup</h1>
        <div className="subtitle">MikroTik / WireGuard remote sites</div>
        <button className={`nav-item ${page.name === 'sites' ? 'active' : ''}`} onClick={() => setPage({ name: 'sites' })}>
          Configured Sites
        </button>
        <button className={`nav-item ${page.name === 'newSite' ? 'active' : ''}`} onClick={() => setPage({ name: 'newSite' })}>
          New Site Setup
        </button>
        <button className={`nav-item ${page.name === 'wifi' ? 'active' : ''}`} onClick={() => setPage({ name: 'wifi' })}>
          Change WiFi Name &amp; Password
        </button>
      </div>
      <div className="main">
        {page.name === 'sites' && (
          <SitesPage refreshToken={refreshToken} onSitesChanged={() => setRefreshToken((t) => t + 1)} />
        )}
        {page.name === 'newSite' && (
          <NewSiteWizard
            onFinished={() => {
              setRefreshToken((t) => t + 1)
              setPage({ name: 'sites' })
            }}
          />
        )}
        {page.name === 'wifi' && <WifiPage />}
      </div>
    </div>
  )
}
