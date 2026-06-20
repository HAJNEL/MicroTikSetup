import { ipcMain, IpcMainInvokeEvent } from 'electron'
import { MikroTikClient } from '../services/MikroTikClient'
import { createLogger, runAndShow } from './logger'
import { SshCredentials, WifiInterfaceInfo, WorkflowResult } from '../shared-types'

interface WifiListResult {
  useNewWifiPackage: boolean
  networks: WifiInterfaceInfo[]
}

export function registerWifiIpc() {
  ipcMain.handle('workflow:wifi:listNetworks', async (event: IpcMainInvokeEvent, creds: SshCredentials): Promise<WifiListResult | WorkflowResult> => {
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

    const useNewWifiPackage = await looksLikeWifiPackage(client)
    const wirelessPath = useNewWifiPackage ? '/interface wifi' : '/interface wireless'

    const interfaceList = await client.run(`${wirelessPath} print terse`)
    const networks = parseInterfaces(interfaceList)
    client.disconnect()

    if (networks.length === 0) {
      log('No wireless interfaces were found on this router.', 'warn')
      return { ok: false, message: 'No wireless interfaces found' }
    }
    return { useNewWifiPackage, networks }
  })

  ipcMain.handle(
    'workflow:wifi:apply',
    async (
      event: IpcMainInvokeEvent,
      creds: SshCredentials,
      useNewWifiPackage: boolean,
      target: WifiInterfaceInfo,
      newSsid: string,
      newPassword: string,
    ): Promise<WorkflowResult & { connectionDropped?: boolean }> => {
      const log = createLogger(event)

      if (newPassword.length < 8) {
        log('WPA2 passwords must be at least 8 characters. Aborting.', 'error')
        return { ok: false, message: 'Password too short' }
      }

      const client = new MikroTikClient(creds.routerIp, creds.username, creds.password)
      try {
        log(`Connecting to ${creds.routerIp}...`)
        await client.connect()
        log('Connected.', 'success')
      } catch (ex: any) {
        log(`Failed to connect: ${ex.message}`, 'error')
        return { ok: false, message: ex.message }
      }

      const wirelessPath = useNewWifiPackage ? '/interface wifi' : '/interface wireless'
      const securityPath = useNewWifiPackage ? '/interface wifi security' : '/interface wireless security-profiles'
      const securityName = target.securityName || 'default'

      log('')
      log("Applying changes. NOTE: if you're connected to this router over the WiFi network")
      log("you're about to rename/re-secure, the connection (and this session) WILL drop")
      log('partway through — that is expected, not an error.')

      // Both changes are sent as ONE command (separated by ';') so RouterOS applies them
      // back-to-back before the WiFi link gets torn down.
      const combinedCommand = useNewWifiPackage
        ? `${securityPath} set [find name="${securityName}"] authentication-types=wpa2-psk,wpa3-psk passphrase="${newPassword}"; ` +
          `${wirelessPath} set [find name="${target.name}"] ssid="${newSsid}" security="${securityName}"`
        : `${securityPath} set [find name="${securityName}"] mode=dynamic-keys authentication-types=wpa2-psk wpa2-pre-shared-key="${newPassword}"; ` +
          `${wirelessPath} set [find name="${target.name}"] ssid="${newSsid}" security-profile="${securityName}"`

      let connectionDropped = false
      try {
        await runAndShow(client, log, 'Applying SSID and security changes (single combined command)', combinedCommand)
      } catch (ex: any) {
        connectionDropped = true
        log('(connection dropped while applying this change — likely expected, see note below)', 'warn')
      }

      log('')
      if (connectionDropped) {
        log('The session was dropped while applying the change — this is expected when')
        log('you are connected over the WiFi network being reconfigured, and usually means')
        log('the change was applied successfully right before the disconnect.')
        log('')
        log(`Reconnect to the new WiFi network "${newSsid}" with the new password, then verify with:`)
      } else {
        log('Done. Verify with:')
      }
      log(`  ${wirelessPath} print`)
      log(`  ${securityPath} print`)
      log('Note: connected WiFi clients (including this computer, if connected over WiFi) will be disconnected and need the new password to reconnect.')

      try {
        client.disconnect()
      } catch {
        // session may already be gone if the WiFi change dropped it
      }
      return { ok: true, connectionDropped }
    },
  )
}

async function looksLikeWifiPackage(client: MikroTikClient): Promise<boolean> {
  const probe = await client.run('/interface wifi print terse')
  return Boolean(probe.trim()) && !probe.includes('no such command')
}

/** Parses "print terse" output (lines of space-separated key=value pairs) into wireless interfaces. */
function parseInterfaces(terseOutput: string): WifiInterfaceInfo[] {
  const result: WifiInterfaceInfo[] = []
  for (const line of terseOutput.split('\n')) {
    if (!line.trim()) continue
    const name = extractField(line, 'name')
    if (!name) continue
    const ssid = extractField(line, 'ssid')
    let security = extractField(line, 'security-profile')
    if (!security) security = extractField(line, 'security')
    result.push({ name, ssid: ssid || '(no SSID set)', securityName: security })
  }
  return result
}

/** Extracts the value of key=value or key="value" from a RouterOS terse-output line. */
function extractField(line: string, key: string): string {
  const marker = `${key}=`
  let idx = line.indexOf(marker)
  while (idx >= 0) {
    if (idx === 0 || line[idx - 1] === ' ') {
      const valueStart = idx + marker.length
      if (valueStart < line.length && line[valueStart] === '"') {
        const end = line.indexOf('"', valueStart + 1)
        if (end > valueStart) return line.substring(valueStart + 1, end)
      } else {
        let end = line.indexOf(' ', valueStart)
        if (end < 0) end = line.length
        return line.substring(valueStart, end)
      }
    }
    idx = line.indexOf(marker, idx + 1)
  }
  return ''
}
