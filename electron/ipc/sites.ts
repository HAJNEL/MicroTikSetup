import { ipcMain } from 'electron'
import { SiteRepository, cidrToSubnetMask } from '../services/SiteRepository'
import { SiteRecord } from '../shared-types'

export function registerSitesIpc(repo: SiteRepository) {
  ipcMain.handle('sites:list', () => repo.loadAll())

  ipcMain.handle('sites:suggestNext', () => repo.suggestNext())

  ipcMain.handle('sites:nameExists', (_e, siteName: string) => repo.siteNameExists(siteName))

  ipcMain.handle('sites:subnetInUse', (_e, lanSubnet: string) => repo.lanSubnetInUse(lanSubnet))

  ipcMain.handle('sites:append', (_e, record: SiteRecord) => {
    repo.append(record)
    return repo.loadAll()
  })

  ipcMain.handle('sites:saveAll', (_e, records: SiteRecord[]) => {
    repo.saveAll(records)
    return repo.loadAll()
  })

  ipcMain.handle('sites:delete', (_e, siteName: string) => {
    const remaining = repo.loadAll().filter((s) => s.siteName !== siteName)
    repo.saveAll(remaining)
    return remaining
  })

  ipcMain.handle('sites:update', (_e, original: string, updated: SiteRecord) => {
    const all = repo.loadAll()
    const idx = all.findIndex((s) => s.siteName === original)
    if (idx >= 0) all[idx] = updated
    repo.saveAll(all)
    return all
  })

  ipcMain.handle('sites:subnetMask', (_e, lanSubnet: string) => cidrToSubnetMask(lanSubnet))
}
