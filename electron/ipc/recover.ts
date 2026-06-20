import { ipcMain, IpcMainInvokeEvent } from 'electron'
import { MikroTikClient } from '../services/MikroTikClient'
import { ConnectionWatchdog } from '../services/ConnectionWatchdog'
import { createLogger, delay } from './logger'
import { SshCredentials, WorkflowResult } from '../shared-types'

/**
 * One-shot manual recovery: connects to a configured site's router and bounces the WireGuard peer
 * (disable -> wait -> enable) to force the VPN tunnel to re-handshake. In-app equivalent of the
 * on-site "disable/enable the peer" fix — brings an offline site back without rebooting the router.
 */
export function registerRecoverTunnelIpc() {
  ipcMain.handle('workflow:recoverTunnel', async (event: IpcMainInvokeEvent, creds: SshCredentials): Promise<WorkflowResult> => {
    const log = createLogger(event)
    const client = new MikroTikClient(creds.routerIp, creds.username, creds.password)

    try {
      log(`Connecting to ${creds.routerIp}...`)
      await client.connect()
      log('Connected.', 'success')
    } catch (ex: any) {
      log(`Failed to connect: ${ex.message}`, 'error')
      return { ok: false, message: ex.message }
    }

    log('')
    log('--- Disabling WireGuard peer ---')
    log(`$ ${ConnectionWatchdog.PeerBounceCommands[0]}`, 'cmd')
    log((await client.run(ConnectionWatchdog.PeerBounceCommands[0])).trimEnd(), 'output')

    log('Waiting 3 seconds...')
    await delay(3000)

    log('')
    log('--- Re-enabling WireGuard peer ---')
    log(`$ ${ConnectionWatchdog.PeerBounceCommands[1]}`, 'cmd')
    log((await client.run(ConnectionWatchdog.PeerBounceCommands[1])).trimEnd(), 'output')

    log('')
    log('Waiting a few seconds for the tunnel to re-handshake...')
    await delay(6000)
    log('')
    log("--- WireGuard peer status (look for a recent 'last-handshake') ---")
    try {
      log((await client.run('/interface wireguard peers print detail')).trimEnd(), 'output')
    } catch (ex: any) {
      log(`(Could not read peer status: ${ex.message})`, 'warn')
    }

    log('')
    log("If 'last-handshake' is only a few seconds ago, the tunnel is back up and the scanner")
    log('should return to online in HikCentral shortly. Consider adding the VPN-recovery')
    log('watchdog so this recovers automatically next time.')

    client.disconnect()
    return { ok: true }
  })
}
