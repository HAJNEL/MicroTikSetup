import { ipcMain, IpcMainInvokeEvent } from 'electron'
import { MikroTikClient } from '../services/MikroTikClient'
import { ConnectionWatchdog } from '../services/ConnectionWatchdog'
import { SiteRepository } from '../services/SiteRepository'
import { createLogger, runAndShow, delay } from './logger'
import { SetupPlan, SetupStep, SiteRecord, WorkflowResult } from '../shared-types'

const EC_SERVER_ENDPOINT = '13.247.35.150'
const EC_SERVER_PORT = 51820
const EC_SERVER_PUBLIC_KEY = 'mWj2IRA4GrRF6/Yg9zL2FOJmUZglv/+xgHc9ZvHmvjc='
const WG_IFACE = 'wg-hikcentral'

export interface SetupResult extends WorkflowResult {
  mikroTikPublicKey?: string
  site?: SiteRecord
  peerBlock?: string
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
        await runVerificationChecks(client2, doStep, log, lanSubnet, plan.wireGuardIp, mikroTikLanIp)
      }
    } else {
      await runVerificationChecks(client, doStep, log, lanSubnet, plan.wireGuardIp, mikroTikLanIp)
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
      }
      repo.append(site)
      log('Saved this site to the tracking CSV.', 'success')
    }

    return { ok: bridgeChangeOk, mikroTikPublicKey, site, peerBlock }
  })
}

async function runVerificationChecks(
  client: MikroTikClient,
  doStep: boolean[],
  log: (text: string, level?: any) => void,
  lanSubnet: string,
  wgIp: string,
  mikroTikLanIp: string,
): Promise<void> {
  log('')
  log('=== Running post-setup verification checks ===')
  const results: boolean[] = []

  const check = async (name: string, command: string, isOk: (output: string) => boolean) => {
    let output: string
    try {
      output = await client.run(command)
    } catch (ex: any) {
      results.push(false)
      log(`  [FAIL] ${name} (could not query router: ${ex.message})`, 'error')
      return
    }
    const passed = isOk(output)
    results.push(passed)
    log(`  [${passed ? 'PASS' : 'FAIL'}] ${name}`, passed ? 'success' : 'error')
  }

  if (doStep[SetupStep.DisableDhcp])
    await check('DHCP server is disabled', '/ip dhcp-server print terse', (o) => o.includes('disabled=yes'))

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
    await check('Firewall forward rule (WG -> LAN) exists', '/ip firewall filter print terse', (o) =>
      o.includes('allow WG to LAN (HikCentral)'),
    )
    await check('Firewall forward rule (LAN -> WG) exists', '/ip firewall filter print terse', (o) =>
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

  if (doStep[SetupStep.ChangeBridgeIp])
    await check('Bridge/LAN IP matches the new address', '/ip address print terse', (o) =>
      o.includes(`address=${mikroTikLanIp}/24`),
    )

  await check('Router can reach the internet (ping 8.8.8.8)', '/ping 8.8.8.8 count=4', (o) => o.includes('packet-loss=0%'))

  log('')
  const failed = results.filter((r) => !r).length
  if (results.length === 0) log('No applicable checks for the selected steps.')
  else if (failed === 0) log(`All ${results.length} verification checks PASSED.`, 'success')
  else log(`${failed} of ${results.length} verification checks FAILED — review the [FAIL] items above.`, 'error')
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
