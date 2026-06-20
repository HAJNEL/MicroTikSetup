import { contextBridge, ipcRenderer } from 'electron'
import type {
  SiteRecord,
  NextSiteSuggestion,
  NetworkAdapterInfo,
  SshCredentials,
  SetupPlan,
  WifiInterfaceInfo,
  LogLine,
} from './shared-types'

const api = {
  sites: {
    list: (): Promise<SiteRecord[]> => ipcRenderer.invoke('sites:list'),
    suggestNext: (): Promise<NextSiteSuggestion> => ipcRenderer.invoke('sites:suggestNext'),
    nameExists: (siteName: string): Promise<boolean> => ipcRenderer.invoke('sites:nameExists', siteName),
    subnetInUse: (lanSubnet: string): Promise<boolean> => ipcRenderer.invoke('sites:subnetInUse', lanSubnet),
    append: (record: SiteRecord): Promise<SiteRecord[]> => ipcRenderer.invoke('sites:append', record),
    saveAll: (records: SiteRecord[]): Promise<SiteRecord[]> => ipcRenderer.invoke('sites:saveAll', records),
    delete: (siteName: string): Promise<SiteRecord[]> => ipcRenderer.invoke('sites:delete', siteName),
    update: (original: string, updated: SiteRecord): Promise<SiteRecord[]> =>
      ipcRenderer.invoke('sites:update', original, updated),
    subnetMask: (lanSubnet: string): Promise<string> => ipcRenderer.invoke('sites:subnetMask', lanSubnet),
  },
  network: {
    detectRouterIp: (): Promise<string | null> => ipcRenderer.invoke('network:detectRouterIp'),
    listAdapters: (): Promise<NetworkAdapterInfo[]> => ipcRenderer.invoke('network:listAdapters'),
    applyStaticIp: (adapterName: string, ip: string, mask: string, gateway: string, dns: string): Promise<boolean> =>
      ipcRenderer.invoke('network:applyStaticIp', adapterName, ip, mask, gateway, dns),
    applyDhcp: (adapterName: string): Promise<boolean> => ipcRenderer.invoke('network:applyDhcp', adapterName),
  },
  workflow: {
    recoverTunnel: (creds: SshCredentials) => ipcRenderer.invoke('workflow:recoverTunnel', creds),
    addWatchdog: (creds: SshCredentials) => ipcRenderer.invoke('workflow:addWatchdog', creds),
    enableRemoteSupport: (creds: SshCredentials) => ipcRenderer.invoke('workflow:enableRemoteSupport', creds),
    runSetup: (plan: SetupPlan) => ipcRenderer.invoke('workflow:runSetup', plan),
    wifi: {
      listNetworks: (creds: SshCredentials) => ipcRenderer.invoke('workflow:wifi:listNetworks', creds),
      apply: (
        creds: SshCredentials,
        useNewWifiPackage: boolean,
        target: WifiInterfaceInfo,
        newSsid: string,
        newPassword: string,
      ) => ipcRenderer.invoke('workflow:wifi:apply', creds, useNewWifiPackage, target, newSsid, newPassword),
    },
    onLog: (callback: (line: LogLine) => void) => {
      const listener = (_e: unknown, line: LogLine) => callback(line)
      ipcRenderer.on('workflow:log', listener)
      return () => {
        ipcRenderer.removeListener('workflow:log', listener)
      }
    },
  },
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
