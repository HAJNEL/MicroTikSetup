import os from 'node:os'
import { spawn } from 'node:child_process'
import { NetworkAdapterInfo } from '../shared-types'

/**
 * Returns the IPv4 default gateway of the active network adapter — i.e. the router this PC is
 * currently connected to (its LAN IP). Node's `os.networkInterfaces()` doesn't expose the gateway
 * directly, so on Windows we shell out to `route print` and find the matching route to the
 * interface that owns one of our non-APIPA IPv4 addresses.
 */
export async function detectRouterIp(): Promise<string | null> {
  if (process.platform !== 'win32') return detectRouterIpPosix()

  try {
    const output = await runCommand('route', ['print', '-4'])
    const localIps = activeIPv4Addresses()
    const lines = output.split(/\r?\n/)
    // Lines look like: "          0.0.0.0          0.0.0.0    192.168.88.1   192.168.88.50    25"
    for (const line of lines) {
      const cols = line.trim().split(/\s+/)
      if (cols.length >= 5 && cols[0] === '0.0.0.0' && cols[1] === '0.0.0.0') {
        const gateway = cols[2]
        const iface = cols[3]
        if (isIpv4(gateway) && localIps.includes(iface)) {
          return gateway
        }
      }
    }
  } catch {
    // fall through to null
  }
  return null
}

function detectRouterIpPosix(): string | null {
  // Best-effort fallback for non-Windows dev environments; not the primary target platform.
  return null
}

function activeIPv4Addresses(): string[] {
  const result: string[] = []
  const interfaces = os.networkInterfaces()
  for (const name of Object.keys(interfaces)) {
    for (const info of interfaces[name] ?? []) {
      if (info.family === 'IPv4' && !info.internal && !info.address.startsWith('169.254.')) {
        result.push(info.address)
      }
    }
  }
  return result
}

function isIpv4(value: string): boolean {
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value)
}

/** Lists Ethernet/WiFi adapters on this machine (Windows: via `netsh interface show interface`). */
export async function listNetworkAdapters(): Promise<NetworkAdapterInfo[]> {
  const interfaces = os.networkInterfaces()
  const adapters: NetworkAdapterInfo[] = []
  for (const name of Object.keys(interfaces)) {
    const infos = interfaces[name] ?? []
    if (infos.length === 0) continue
    if (name.toLowerCase().includes('loopback')) continue
    const hasIpv4 = infos.some((i) => i.family === 'IPv4')
    if (!hasIpv4) continue
    const lower = name.toLowerCase()
    const kind: NetworkAdapterInfo['kind'] = lower.includes('wi-fi') || lower.includes('wifi') || lower.includes('wlan')
      ? 'Wireless80211'
      : lower.includes('eth') || lower.includes('ethernet')
        ? 'Ethernet'
        : 'Other'
    adapters.push({ name, description: name, status: 'Up', kind })
  }
  return adapters
}

/** Runs `netsh interface ipv4 set address ...` elevated (triggers a UAC prompt on Windows). */
export async function applyStaticIp(
  adapterName: string,
  ip: string,
  mask: string,
  gateway: string,
  dns: string,
): Promise<boolean> {
  const ok1 = await runElevatedNetsh(`interface ipv4 set address name="${adapterName}" static ${ip} ${mask} ${gateway}`)
  const ok2 = await runElevatedNetsh(`interface ipv4 set dnsservers name="${adapterName}" static ${dns} primary`)
  return ok1 && ok2
}

/** Switches an adapter back to automatic DHCP for both IP and DNS. */
export async function applyDhcp(adapterName: string): Promise<boolean> {
  const ok1 = await runElevatedNetsh(`interface ipv4 set address name="${adapterName}" source=dhcp`)
  const ok2 = await runElevatedNetsh(`interface ipv4 set dnsservers name="${adapterName}" source=dhcp`)
  return ok1 && ok2
}

/**
 * Runs a netsh command elevated via PowerShell's `Start-Process -Verb RunAs -Wait`, which surfaces
 * the same UAC prompt the original .NET app showed via `ProcessStartInfo { Verb = "runas" }`.
 */
function runElevatedNetsh(netshArgs: string): Promise<boolean> {
  if (process.platform !== 'win32') {
    return Promise.resolve(false)
  }
  return new Promise((resolve) => {
    const psCommand = `Start-Process netsh -ArgumentList '${netshArgs.replace(/'/g, "''")}' -Verb RunAs -Wait -WindowStyle Hidden`
    const child = spawn('powershell.exe', ['-NoProfile', '-Command', psCommand], { windowsHide: true })
    child.on('close', (code) => resolve(code === 0))
    child.on('error', () => resolve(false))
  })
}

function runCommand(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true })
    let out = ''
    child.stdout.on('data', (d) => (out += d.toString()))
    child.on('close', () => resolve(out))
    child.on('error', reject)
  })
}
