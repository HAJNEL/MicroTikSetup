import { ipcMain, IpcMainInvokeEvent } from 'electron'
import { MikroTikClient } from '../services/MikroTikClient'
import { createLogger, runAndShow } from './logger'
import { SshCredentials, WorkflowResult } from '../shared-types'

/**
 * Enables remote support on a configured site's router: MikroTik DDNS Cloud, RoMON for secure
 * remote agent discovery, an input firewall rule guaranteeing management access over the
 * WireGuard tunnel, then hardens the router by disabling unneeded services. SSH, WinBox and
 * WebFig are intentionally left enabled so the site stays manageable from home.
 */
const WG_SUBNET = '10.10.0.0/24'
const MGMT_PORTS = '22,8291,80,443'
const MGMT_RULE_COMMENT = 'allow remote mgmt over WG (HikCentral)'

export function registerRemoteSupportIpc() {
  ipcMain.handle('workflow:enableRemoteSupport', async (event: IpcMainInvokeEvent, creds: SshCredentials): Promise<WorkflowResult> => {
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

    await runAndShow(client, log, 'Enabling MikroTik Cloud DDNS', '/ip cloud set ddns-enabled=yes update-time=yes')
    await runAndShow(client, log, 'Forcing Cloud update', '/ip cloud force-update')
    await runAndShow(client, log, 'Enabling RoMON', '/tool romon set enabled=yes')

    await client.run(`/ip firewall filter remove [find comment="${MGMT_RULE_COMMENT}"]`)
    await runAndShow(
      client,
      log,
      'Allowing remote management over the WG tunnel',
      `/ip firewall filter add chain=input src-address=${WG_SUBNET} protocol=tcp ` +
        `dst-port=${MGMT_PORTS} action=accept comment="${MGMT_RULE_COMMENT}" place-before=0`,
    )

    await runAndShow(client, log, 'Disabling unused services', '/ip service disable api,api-ssl,ftp,telnet')

    log('')
    log('=== MikroTik Cloud status (note the dns-name below — that is the router\'s remote URL) ===')
    try {
      log((await client.run('/ip cloud print')).trimEnd(), 'output')
    } catch (ex: any) {
      log(`(Could not read cloud status: ${ex.message})`, 'warn')
    }

    log('')
    log('Remote support is enabled. From home, reach this router over the WireGuard tunnel at')
    log(`${creds.routerIp} (or its 10.10.0.x address) using WinBox, a browser (WebFig) or SSH.`)
    log('A firewall rule now guarantees those over the tunnel; RoMON is on for agent discovery;')
    log('unused services (api, ftp, telnet) are disabled.')
    log('')
    log('Note: over LTE the router usually has no public IP (CGNAT), so the Cloud dns-name above')
    log('may not be reachable from the internet directly — the WireGuard tunnel is your remote path.')

    client.disconnect()
    return { ok: true }
  })
}
