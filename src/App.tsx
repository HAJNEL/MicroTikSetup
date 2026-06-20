import React, { useEffect, useState } from 'react'
import SitesPage from './pages/SitesPage'
import NewSiteWizard from './pages/NewSiteWizard'
import WifiPage from './pages/WifiPage'
import HomePage from './pages/HomePage'

type Page = { name: 'home' } | { name: 'sites' } | { name: 'newSite' } | { name: 'wifi' }

const NAV: { page: Page['name']; icon: string; label: string }[] = [
  { page: 'home', icon: '🏠', label: 'Home' },
  { page: 'newSite', icon: '➕', label: 'Set up a new site' },
  { page: 'sites', icon: '📍', label: 'Manage sites' },
  { page: 'wifi', icon: '📶', label: 'Change WiFi password' },
]

export default function App() {
  const [page, setPage] = useState<Page>({ name: 'home' })
  const [refreshToken, setRefreshToken] = useState(0)
  const [siteCount, setSiteCount] = useState<number | null>(null)

  useEffect(() => {
    window.api.sites.list().then((list) => setSiteCount(list.length))
  }, [refreshToken])

  return (
    <div className="app-shell">
      <div className="sidebar">
        <div className="brand">
          <h1>HikCentral Site Setup</h1>
          <div className="subtitle">MikroTik / WireGuard remote sites</div>
        </div>
        {NAV.map((item) => (
          <button
            key={item.page}
            className={`nav-item ${page.name === item.page ? 'active' : ''}`}
            onClick={() => setPage({ name: item.page } as Page)}
          >
            <span className="nav-icon">{item.icon}</span>
            {item.label}
          </button>
        ))}
        <div className="sidebar-spacer" />
        <div className="sidebar-foot">
          {siteCount === null ? '' : `${siteCount} site${siteCount === 1 ? '' : 's'} configured`}
        </div>
      </div>
      <div className="main">
        {page.name === 'home' && (
          <HomePage
            siteCount={siteCount}
            onNewSite={() => setPage({ name: 'newSite' })}
            onManageSites={() => setPage({ name: 'sites' })}
            onWifi={() => setPage({ name: 'wifi' })}
          />
        )}
        {page.name === 'sites' && (
          <SitesPage
            refreshToken={refreshToken}
            onSitesChanged={() => setRefreshToken((t) => t + 1)}
            onNewSite={() => setPage({ name: 'newSite' })}
          />
        )}
        {page.name === 'newSite' && (
          <NewSiteWizard
            onFinished={() => {
              setRefreshToken((t) => t + 1)
              setPage({ name: 'sites' })
            }}
            onCancel={() => setPage({ name: 'home' })}
          />
        )}
        {page.name === 'wifi' && <WifiPage />}
      </div>
    </div>
  )
}
