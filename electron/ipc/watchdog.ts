import { ipcMain, IpcMainInvokeEvent } from 'electron'
import { MikroTikClient } from '../services/MikroTikClient'
import { ConnectionWatchdog } from '../services/ConnectionWatchdog'
import { createLogger } from './logger'
import { SshCredentials, WorkflowResult } from '../shared-types'

/**
 * Adds the VPN-recovery watchdog to an already-configured site's router. Connects at the site's
 * recorded LAN IP and only installs the watchdog scheduler — nothing else on the router changes.
 */
export function registerWatchdogIpc() {
  ipcMain.handle('workflow:addWatchdog', async (event: IpcMainInvokeEvent, creds: SshCredentials): Promise<WorkflowResult> => {
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

    await ConnectionWatchdog.apply(client, log)

    log('')
    log('=== Verifying the watchdog entry ===')
    try {
      const output = await client.run('/system scheduler print terse')
      const present = ConnectionWatchdog.isPresent(output)
      log(`  [${present ? 'PASS' : 'FAIL'}] VPN-recovery watchdog (scheduler) exists`, present ? 'success' : 'error')
    } catch (ex: any) {
      log(`  [FAIL] Could not query the router to verify: ${ex.message}`, 'error')
    }

    client.disconnect()
    return { ok: true }
  })
}
