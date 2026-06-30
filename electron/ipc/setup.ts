import { ipcMain, IpcMainInvokeEvent } from 'electron'
import { MikroTikClient } from '../services/MikroTikClient'
import { ConnectionWatchdog } from '../services/ConnectionWatchdog'
import { SiteRepository } from '../services/SiteRepository'
import { createLogger, runAndShow, delay } from './logger'
import {
  SetupPlan,
  SetupStep,
  SETUP_STEP_LABELS,
  SiteRecord,
  WorkflowResult,
  SshCredentials,
  CheckResult,
  BRIDGE_IP_CHECK_NAME,
} from '../shared-types'

const EC_SERVER_ENDPOINT = '13.247.35.150'
const EC_SERVER_PORT = 51820
const EC_SERVER_PUBLIC_KEY = 'mWj2IRA4GrRF6/Yg9zL2FOJmUZglv/+xgHc9ZvHmvjc='
const WG_IFACE = 'wg-hikcentral'

export interface SetupResult extends WorkflowResult {
  mikroTikPublicKey?: string
  site?: SiteRecord
  peerBlock?: string
  checkResults?: CheckResult[]
}

export function registerSetupIpc(repo: SiteRepository) {
  ipcMain.handle('workflow:runSetup', async (event: IpcMainInvokeEvent, plan: SetupPlan): Promise<SetupResult> => {
    const log = createLogger(event)
    const lanThird = plan.lanThirdOctet
    const lanSubnet = `192.168.${lanThird}.0/24`
    const mikroTikLanIp = `192.168.${lanThird}.1`
    const deviceIp = `192.168.${lanThird}.200`
    const deviceGateway = mikroTikLanIp
    const doStep = plan.steps

    const client = new MikroTikClient(plan.currentRouterIp, plan.username, plan.password)
    try {
      log(`Connecting to ${plan.currentRouterIp}...`)
      await client.connect()
      log('Connected.', 'success')
    } catch (ex: any) {
      log(`Failed to connect: ${ex.message}`, 'error')
      if (doStep[SetupStep.SaveToCsv]) {
        const partialSite: SiteRecord = {
          siteName: plan.siteName,
          wireGuardIp: plan.wireGuardIp,
          lanSubnet,
          mikroTikLanIp,
          deviceIp,
          deviceGateway,
          mikroTikPublicKey: '',
          dateConfigured: formatDate(new Date()),
        }
        repo.upsert(partialSite)
        log('Site details saved to the tracking list (setup incomplete — connect to the router and run setup again to finish).', 'warn')
      }
      return { ok: false, message: ex.message }
    }

    // --- 1.1 Disable DHCP server ---
    if (doStep[SetupStep.DisableDhcp]) {
      await runAndShow(client, log, 'Disabling DHCP server (1.1)', '/ip dhcp-server set 0 disabled=yes')
    }

    // --- Power-cycle LTE modem ---
    if (doStep[SetupStep.LteCycle]) {
      log('')
      log('--- Power-cycling the LTE modem (disable/enable lte1) ---')
      log('This forces the modem radio to re-initialize, which is sometimes needed')
      log('for it to register on the cellular network after a SIM is inserted.')
      await runAndShow(client, log, 'Disabling lte1', '/interface lte disable lte1')
      log('Waiting a few seconds before re-enabling...')
      await delay(5000)
      await runAndShow(client, log, 'Enabling lte1', '/interface lte enable lte1')
      log('Waiting for the radio to register on the cellular network...')
      await delay(30000)
      log((await client.run('/interface lte monitor lte1 once')).trimEnd(), 'output')
    }

    // --- WireGuard tunnel ---
    let mikroTikPublicKey = ''
    if (doStep[SetupStep.WireGuard]) {
      await runAndShow(
        client,
        log,
        'Creating WireGuard interface (1.2)',
        `/interface wireguard add name=${WG_IFACE} listen-port=${EC_SERVER_PORT} mtu=1380`,
      )

      const detailOutput = await runAndShow(
        client,
        log,
        'Reading MikroTik public key (1.3)',
        `/interface wireguard print detail where name=${WG_IFACE}`,
      )
      mikroTikPublicKey = extractPublicKey(detailOutput)
      if (!mikroTikPublicKey) {
        log('Could not automatically extract the public key. Run:', 'warn')
        log('  /interface wireguard print detail')
      } else {
        log(`  -> Public key: ${mikroTikPublicKey}`)
      }

      await runAndShow(
        client,
        log,
        'Assigning WireGuard IP address (1.4)',
        `/ip address add address=${plan.wireGuardIp}/24 interface=${WG_IFACE}`,
      )

      await runAndShow(
        client,
        log,
        'Adding EC2 server as WireGuard peer (1.5)',
        `/interface wireguard peers add interface=${WG_IFACE} public-key="${EC_SERVER_PUBLIC_KEY}" ` +
          `endpoint-address=${EC_SERVER_ENDPOINT} endpoint-port=${EC_SERVER_PORT} ` +
          `allowed-address=10.10.0.1/32 persistent-keepalive=25s`,
      )
    } else {
      // Try to read back an existing public key so the EC2 peer block / record can still be produced.
      const existing = await client.run(`/interface wireguard print detail where name=${WG_IFACE}`)
      mikroTikPublicKey = extractPublicKey(existing)
      if (mikroTikPublicKey) log(`Found existing WireGuard public key: ${mikroTikPublicKey}`)
    }

    // --- Firewall forward rules ---
    if (doStep[SetupStep.FirewallForward]) {
      await runAndShow(
        client,
        log,
        'Adding firewall forward rules (1.6)',
        `/ip firewall filter add chain=forward src-address=10.10.0.0/24 dst-address=${lanSubnet} ` +
          `action=accept comment="allow WG to LAN (HikCentral)" place-before=0`,
      )
      await runAndShow(
        client,
        log,
        'Adding firewall forward rules (1.6, reverse)',
        `/ip firewall filter add chain=forward src-address=${lanSubnet} dst-address=10.10.0.0/24 ` +
          `action=accept comment="allow LAN to WG (HikCentral)" place-before=0`,
      )
    }

    // --- MSS clamping ---
    if (doStep[SetupStep.MssClamping]) {
      await runAndShow(
        client,
        log,
        'Adding MSS clamping rules (1.7, in)',
        '/ip firewall mangle add chain=forward in-interface=wg-hikcentral protocol=tcp tcp-flags=syn ' +
          'action=change-mss new-mss=1340 passthrough=yes comment="clamp MSS for WG tunnel in"',
      )
      await runAndShow(
        client,
        log,
        'Adding MSS clamping rules (1.7, out)',
        '/ip firewall mangle add chain=forward out-interface=wg-hikcentral protocol=tcp tcp-flags=syn ' +
          'action=change-mss new-mss=1340 passthrough=yes comment="clamp MSS for WG tunnel out"',
      )
    }

    // --- NAT ---
    if (doStep[SetupStep.Nat]) {
      await runAndShow(
        client,
        log,
        'Adding NAT masquerade for new LAN subnet (1.8)',
        `/ip firewall nat add chain=srcnat action=masquerade src-address=${lanSubnet} ` +
          'out-interface=lte1 comment="LAN internet via LTE"',
      )
    }

    // --- Watchdog ---
    if (doStep[SetupStep.Watchdog]) {
      await ConnectionWatchdog.apply(client, log)
    }

    // --- Verify internet (1.9) ---
    if (doStep[SetupStep.VerifyInternet]) {
      log('')
      log('--- Verifying MikroTik internet (1.9) ---')
      log((await client.run('/ping 8.8.8.8 count=4')).trimEnd(), 'output')
      log((await client.run('/ping google.com count=4')).trimEnd(), 'output')
    }

    let bridgeChangeOk = true
    let finalClient = client
    let checkResults: CheckResult[] = []
    if (doStep[SetupStep.ChangeBridgeIp]) {
      log('')
      log('=== Changing bridge/LAN IP (1.10-1.11) ===')
      log('Make sure you have already set THIS computer to a manual/static IP on the new subnet')
      log(`(${`192.168.${lanThird}.2`} / 255.255.255.0 / gateway ${mikroTikLanIp}) before this step runs —`)
      log('the Setup wizard in this app will have prompted you for that before reaching here.')
      log('This will disconnect the current session. That is expected.')

      try {
        await client.run(`/ip address set 0 address=${mikroTikLanIp}/24`)
      } catch {
        // connection drop while the command applies is expected
      }
      client.disconnect()

      log('')
      log(`Reconnecting at the new address ${mikroTikLanIp} ...`)
      log('(Waiting a few seconds for the change to take effect.)')
      await delay(8000)

      const client2 = new MikroTikClient(mikroTikLanIp, plan.username, plan.password)
      const reconnected = await tryConnectWithRetries(client2, 6, 5000)
      if (!reconnected) {
        log(`Could not reconnect to ${mikroTikLanIp} automatically.`, 'error')
        log('Open WinBox -> Neighbors -> click the router MAC address to recover, then')
        log('verify the bridge address manually with: /ip address print')
        bridgeChangeOk = false
        // Couldn't reconnect to verify anything — record this as a failed check instead of silently
        // returning no results, so the mismatch is visible on the result screen and saved to the site record.
        checkResults = [{ name: BRIDGE_IP_CHECK_NAME, passed: false }]
      } else {
        log('Reconnected. Running full verification (1.13)...', 'success')
        for (const cmd of [
          '/interface wireguard print detail',
          '/ip address print',
          '/interface wireguard peers print detail',
          '/ip firewall filter print',
          '/ip firewall mangle print',
          '/ip firewall nat print',
          '/ip route print',
        ]) {
          await runAndShow(client2, log, cmd, cmd)
        }
        finalClient = client2
        checkResults = await runVerificationChecks(client2, doStep, log, lanSubnet, plan.wireGuardIp, mikroTikLanIp)
      }
    } else {
      checkResults = await runVerificationChecks(client, doStep, log, lanSubnet, plan.wireGuardIp, mikroTikLanIp)
    }

    try {
      finalClient.disconnect()
    } catch {
      /* already gone */
    }

    let peerBlock = ''
    if (mikroTikPublicKey) {
      peerBlock =
        `#${plan.siteName}\n[Peer]\nPublicKey = ${mikroTikPublicKey}\n` +
        `AllowedIPs = ${plan.wireGuardIp}/32, ${lanSubnet}`
      log('')
      log('=== Add this [Peer] block to the EC2 WireGuard (KyospanServer) config ===')
      log('Do NOT remove or modify any existing [Peer] sections — only append this one:')
      log('')
      log(peerBlock, 'output')
    }

    log('')
    log('=== Next: configure the Hikvision device via its web UI (Part 3 of the guide) ===')
    log(`  Static IP      : ${deviceIp}`)
    log('  Subnet mask    : 255.255.255.0')
    log(`  Default gateway: ${deviceGateway}`)
    log('  DNS            : 8.8.8.8')
    log('  NTP server     : pool.ntp.org')
    log('  SDK port       : 8000 (leave default)')
    log('')
    log("Don't forget to reset this computer's IP back to DHCP once everything is verified.")

    let site: SiteRecord | undefined
    if (doStep[SetupStep.SaveToCsv]) {
      site = {
        siteName: plan.siteName,
        wireGuardIp: plan.wireGuardIp,
        lanSubnet,
        mikroTikLanIp,
        deviceIp,
        deviceGateway,
        mikroTikPublicKey,
        dateConfigured: formatDate(new Date()),
        lastCheckResults: checkResults.length > 0 ? JSON.stringify(checkResults) : undefined,
      }
      repo.upsert(site)
      log('Saved this site to the tracking CSV.', 'success')
    }

    return { ok: bridgeChangeOk, mikroTikPublicKey, site, peerBlock, checkResults }
  })

  ipcMain.handle(
    'workflow:fixBridgeIp',
    async (
      event: IpcMainInvokeEvent,
      currentRouterIp: string,
      creds: SshCredentials,
      newBridgeIp: string,
    ): Promise<{ ok: boolean; message?: string }> => {
      const log = createLogger(event)
      const client = new MikroTikClient(currentRouterIp, creds.username, creds.password)

      try {
        log(`Connecting to ${currentRouterIp}...`)
        await client.connect()
        log('Connected.', 'success')
      } catch (ex: any) {
        log(`Failed to connect: ${ex.message}`, 'error')
        return { ok: false, message: ex.message }
      }

      // Auto-detect which IP address entry belongs to the bridge interface.
      let bridgeIdx = 0
      try {
        const out = await client.run('/ip address print terse where interface=bridge')
        const m = out.match(/^\s*(\d+)/m)
        if (m) {
          bridgeIdx = parseInt(m[1], 10)
          log(`Found bridge address at entry ${bridgeIdx}.`)
        } else {
          log('Could not detect bridge entry index — defaulting to 0.', 'warn')
        }
      } catch {
        log('Could not query IP address table — defaulting to entry 0.', 'warn')
      }

      log(`Setting bridge IP to ${newBridgeIp}/24 (this will disconnect the current session)…`)
      try {
        await client.run(`/ip address set ${bridgeIdx} address=${newBridgeIp}/24`)
      } catch {
        // Expected — connection drops as the IP takes effect.
      }
      client.disconnect()

      log('')
      log(`Waiting for router to come up at ${newBridgeIp}…`)
      await delay(8000)

      const client2 = new MikroTikClient(newBridgeIp, creds.username, creds.password)
      const reconnected = await tryConnectWithRetries(client2, 6, 5000)
      if (!reconnected) {
        log(`Could not reconnect to ${newBridgeIp}.`, 'error')
        log('Open WinBox → Neighbors → click the router MAC address to verify the change took effect.')
        return { ok: false, message: `Could not reconnect to ${newBridgeIp} after IP change` }
      }

      log(`Reconnected at ${newBridgeIp}.`, 'success')
      const addrOut = await runAndShow(client2, log, 'Verify IP addresses', '/ip address print')
      try { client2.disconnect() } catch { /* gone */ }

      const verified = addrOut.includes(`${newBridgeIp}/24`)
      if (verified) {
        log(`Bridge IP is now ${newBridgeIp}/24. ✓`, 'success')
      } else {
        log(`Bridge IP change may not have applied correctly — check /ip address print manually.`, 'warn')
      }

      return { ok: verified, message: verified ? undefined : 'Bridge IP was changed but could not be verified in the output.' }
    },
  )

  ipcMain.handle(
    'workflow:configCheck',
    async (
      event: IpcMainInvokeEvent,
      siteName: string,
      creds: SshCredentials,
    ): Promise<{
      ok: boolean
      message?: string
      mikroTikPublicKey?: string
      updatedSite?: SiteRecord
      checkResults?: CheckResult[]
    }> => {
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

      // Load site record up-front so subnet/IP info is available for verification checks.
      const all = repo.loadAll()
      const idx = all.findIndex((r) => r.siteName.toLowerCase() === siteName.toLowerCase())
      const siteRecord = idx >= 0 ? all[idx] : undefined

      log('')
      log('=== Reading current router configuration ===')

      let mikroTikPublicKey = ''

      const tryRead = async (label: string, cmd: string) => {
        try {
          return await runAndShow(client, log, label, cmd)
        } catch (ex: any) {
          log(`  Could not read ${label}: ${ex.message}`, 'warn')
          return ''
        }
      }

      const wgDetail = await tryRead('WireGuard interface detail', `/interface wireguard print detail where name=${WG_IFACE}`)
      mikroTikPublicKey = extractPublicKey(wgDetail)
      if (mikroTikPublicKey) log(`  -> Public key: ${mikroTikPublicKey}`)
      else log('  -> WireGuard interface not found or public key unavailable.', 'warn')

      await tryRead('WireGuard peers', '/interface wireguard peers print detail')
      await tryRead('IP addresses', '/ip address print')
      await tryRead('Firewall filter rules', '/ip firewall filter print terse')
      await tryRead('Firewall NAT rules', '/ip firewall nat print terse')
      await tryRead('System scheduler (watchdog)', '/system scheduler print terse')

      // Run all applicable verification checks (skip LTE cycle, since we didn't power-cycle the modem here).
      const configCheckSteps = Array.from(
        { length: SETUP_STEP_LABELS.length },
        (_, i) => i !== SetupStep.LteCycle && i !== SetupStep.SaveToCsv && i !== SetupStep.VerifyInternet,
      )
      const checkResults = await runVerificationChecks(
        client,
        configCheckSteps,
        log,
        siteRecord?.lanSubnet ?? '',
        siteRecord?.wireGuardIp ?? '',
        siteRecord?.mikroTikLanIp ?? '',
      )

      try {
        client.disconnect()
      } catch {
        /* already gone */
      }

      let updatedSite: SiteRecord | undefined
      if (idx >= 0) {
        const needsKeyUpdate = !!mikroTikPublicKey && all[idx].mikroTikPublicKey !== mikroTikPublicKey
        all[idx] = {
          ...all[idx],
          ...(needsKeyUpdate ? { mikroTikPublicKey } : {}),
          lastCheckResults: checkResults.length > 0 ? JSON.stringify(checkResults) : all[idx].lastCheckResults,
        }
        repo.saveAll(all)
        updatedSite = all[idx]
        if (needsKeyUpdate) {
          log('')
          log(`Public key saved to site record for "${siteName}".`, 'success')
        } else if (mikroTikPublicKey) {
          log('')
          log('Public key matches existing record — no update needed.', 'success')
        }
      }

      return { ok: true, mikroTikPublicKey, updatedSite, checkResults }
    },
  )
}

async function runVerificationChecks(
  client: MikroTikClient,
  doStep: boolean[],
  log: (text: string, level?: any) => void,
  lanSubnet: string,
  wgIp: string,
  mikroTikLanIp: string,
): Promise<CheckResult[]> {
  log('')
  log('=== Running post-setup verification checks ===')
  const checkResults: CheckResult[] = []

  const check = async (name: string, command: string, isOk: (output: string) => boolean) => {
    let output: string
    try {
      output = await client.run(command)
    } catch (ex: any) {
      checkResults.push({ name, passed: false })
      log(`  [FAIL] ${name} (could not query router: ${ex.message})`, 'error')
      return
    }
    const passed = isOk(output)
    checkResults.push({ name, passed })
    log(`  [${passed ? 'PASS' : 'FAIL'}] ${name}`, passed ? 'success' : 'error')
  }

  if (doStep[SetupStep.DisableDhcp])
    // Pass if there is no enabled DHCP server (no output, or all entries show disabled=yes)
    await check('DHCP server is disabled', '/ip dhcp-server print terse', (o) => !o.includes('disabled=no'))

  if (doStep[SetupStep.LteCycle])
    await check(
      'LTE modem is registered on the cellular network',
      '/interface lte monitor lte1 once',
      (o) => o.includes('status: registered') || o.includes('registration-status: registered'),
    )

  if (doStep[SetupStep.WireGuard]) {
    await check('WireGuard interface exists', '/interface wireguard print terse', (o) =>
      o.includes(`name=${WG_IFACE}`) || o.includes(`name="${WG_IFACE}"`),
    )
    await check('WireGuard IP address is assigned', '/ip address print terse', (o) => o.includes(`address=${wgIp}/24`))
    await check('EC2 server is configured as a peer', '/interface wireguard peers print terse', (o) =>
      o.includes(EC_SERVER_PUBLIC_KEY),
    )
  }

  if (doStep[SetupStep.FirewallForward]) {
    await check('Firewall forward rule (WG → LAN) exists', '/ip firewall filter print terse', (o) =>
      o.includes('allow WG to LAN (HikCentral)'),
    )
    await check('Firewall forward rule (LAN → WG) exists', '/ip firewall filter print terse', (o) =>
      o.includes('allow LAN to WG (HikCentral)'),
    )
  }

  if (doStep[SetupStep.MssClamping]) {
    await check('MSS clamping rule (inbound) exists', '/ip firewall mangle print terse', (o) =>
      o.includes('clamp MSS for WG tunnel in'),
    )
    await check('MSS clamping rule (outbound) exists', '/ip firewall mangle print terse', (o) =>
      o.includes('clamp MSS for WG tunnel out'),
    )
  }

  if (doStep[SetupStep.Nat])
    await check('NAT masquerade rule exists', '/ip firewall nat print terse', (o) => o.includes('LAN internet via LTE'))

  if (doStep[SetupStep.Watchdog])
    await check('VPN-recovery watchdog (scheduler) exists', '/system scheduler print terse', ConnectionWatchdog.isPresent)

  // Always verified, regardless of whether this run changed the bridge IP — a router whose bridge
  // never got moved to the site's subnet (e.g. a previous run's reconnect failed silently) is a
  // common, hard-to-diagnose failure mode and should always be caught.
  if (mikroTikLanIp)
    await check(BRIDGE_IP_CHECK_NAME, '/ip address print terse', (o) => o.includes(`address=${mikroTikLanIp}/24`))

  if (doStep[SetupStep.VerifyInternet])
    await check('Router can reach the internet (ping 8.8.8.8)', '/ping 8.8.8.8 count=4', (o) => o.includes('packet-loss=0%'))

  log('')
  const failed = checkResults.filter((r) => !r.passed).length
  if (checkResults.length === 0) log('No applicable checks for the selected steps.')
  else if (failed === 0) log(`All ${checkResults.length} verification checks PASSED.`, 'success')
  else log(`${failed} of ${checkResults.length} verification checks FAILED — review the [FAIL] items above.`, 'error')

  return checkResults
}

async function tryConnectWithRetries(client: MikroTikClient, attempts: number, delayMs: number): Promise<boolean> {
  for (let i = 1; i <= attempts; i++) {
    try {
      await client.connect()
      return true
    } catch {
      await delay(delayMs)
    }
  }
  return false
}

function extractPublicKey(printDetailOutput: string): string {
  const marker = 'public-key='
  const idx = printDetailOutput.indexOf(marker)
  if (idx < 0) return ''
  let start = idx + marker.length
  if (printDetailOutput[start] === '"') {
    const end = printDetailOutput.indexOf('"', start + 1)
    if (end > start) return printDetailOutput.substring(start + 1, end)
  }
  const match = printDetailOutput.substring(start).match(/^[^\s\r\n]+/)
  return match ? match[0].replace(/"/g, '') : ''
}

function formatDate(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
