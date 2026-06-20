// Shared types between main, preload and renderer. Keep this dependency-free
// (no Node/Electron imports) so it can be imported from renderer code too.

export interface SiteRecord {
  siteName: string
  wireGuardIp: string // e.g. 10.10.0.3
  lanSubnet: string // e.g. 192.168.89.0/24
  mikroTikLanIp: string // e.g. 192.168.89.1
  deviceIp: string // e.g. 192.168.89.200
  deviceGateway: string // e.g. 192.168.89.1
  mikroTikPublicKey: string
  dateConfigured: string
}

export const emptySite = (): SiteRecord => ({
  siteName: '',
  wireGuardIp: '',
  lanSubnet: '',
  mikroTikLanIp: '',
  deviceIp: '',
  deviceGateway: '',
  mikroTikPublicKey: '',
  dateConfigured: '',
})

export interface NextSiteSuggestion {
  wgOctet: number
  lanThirdOctet: number
}

export interface SshCredentials {
  routerIp: string
  username: string
  password: string
}

export interface SetupPlan {
  siteName: string
  wireGuardIp: string
  lanThirdOctet: number
  currentRouterIp: string
  username: string
  password: string
  /** index-aligned with SETUP_STEP_LABELS */
  steps: boolean[]
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
] as const

export const enum SetupStep {
  DisableDhcp = 0,
  LteCycle = 1,
  WireGuard = 2,
  FirewallForward = 3,
  MssClamping = 4,
  Nat = 5,
  Watchdog = 6,
  VerifyInternet = 7,
  ChangeBridgeIp = 8,
  SaveToCsv = 9,
}

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

export type LogLevel = 'info' | 'cmd' | 'output' | 'warn' | 'error' | 'success'

export interface LogLine {
  level: LogLevel
  text: string
}

export interface WorkflowResult {
  ok: boolean
  message?: string
}
