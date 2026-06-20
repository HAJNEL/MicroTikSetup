import { ipcMain } from 'electron'
import * as NetworkHelper from '../services/NetworkHelper'

export function registerNetworkIpc() {
  ipcMain.handle('network:detectRouterIp', () => NetworkHelper.detectRouterIp())

  ipcMain.handle('network:listAdapters', () => NetworkHelper.listNetworkAdapters())

  ipcMain.handle(
    'network:applyStaticIp',
    (_e, adapterName: string, ip: string, mask: string, gateway: string, dns: string) =>
      NetworkHelper.applyStaticIp(adapterName, ip, mask, gateway, dns),
  )

  ipcMain.handle('network:applyDhcp', (_e, adapterName: string) => NetworkHelper.applyDhcp(adapterName))
}
