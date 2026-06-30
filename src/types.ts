import type { Api } from '../electron/preload'

export interface SiteRecord {
  siteName: string
  wireGuardIp: string
  lanSubnet: string
  mikroTikLanIp: string
  deviceIp: string
  deviceGateway: string
  mikroTikPublicKey: string
  dateConfigured: string
  /** JSON-serialised CheckResult[] from the last setup or config check run. */
  lastCheckResults?: string
}

export interface NextSiteSuggestion {
  wgOctet: number
  lanThirdOctet: number
}

export interface SshCredentials {
  routerIp: string
  username: string
  password: string
}

export type LogLevel = 'info' | 'cmd' | 'output' | 'warn' | 'error' | 'success'

export interface LogLine {
  level: LogLevel
  text: string
}

export interface WorkflowResult {
  ok: boolean
  message?: string
}

export interface CheckResult {
  name: string
  passed: boolean
}

/** Name of the verification check that confirms the router's bridge/LAN IP matches the site's expected subnet. */
export const BRIDGE_IP_CHECK_NAME = 'Bridge/LAN IP matches the new address'

export interface NetworkAdapterInfo {
  name: string
  description: string
  status: string
  kind: 'Ethernet' | 'Wireless80211' | 'Other'
}

export interface WifiInterfaceInfo {
  name: string
  ssid: string
  securityName: string
}

export const SETUP_STEP_LABELS = [
  'Disable DHCP server (1.1)',
  'Power-cycle LTE modem so its radio comes up (disable/enable lte1)',
  'Configure WireGuard tunnel - interface, IP, EC2 peer (1.2-1.5)',
  'Add firewall forward rules (1.6)',
  'Add MSS clamping rules (1.7)',
  'Add NAT masquerade for internet access (1.8)',
  'Add VPN-recovery watchdog (auto-reconnect tunnel when LTE drops)',
  'Verify MikroTik internet connectivity (1.9)',
  'Change bridge/LAN IP and reconnect (1.10-1.13)',
  'Save this site to the tracking CSV',
]

export const STEP_CHANGE_BRIDGE_IP = 8

export interface SetupPlan {
  siteName: string
  wireGuardIp: string
  lanThirdOctet: number
  currentRouterIp: string
  username: string
  password: string
  steps: boolean[]
}

declare global {
  interface Window {
    api: Api
  }
}
