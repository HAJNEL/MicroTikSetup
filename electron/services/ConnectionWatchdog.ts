import { MikroTikClient } from './MikroTikClient'

/**
 * Shared logic for the VPN-recovery watchdog. Installs a RouterOS system scheduler that runs every
 * 30s, pings the EC2 WireGuard server over the tunnel (10.10.0.1) and — if it is unreachable —
 * bounces the WireGuard peer (disable/enable) to force a fresh handshake. A scheduler is used
 * rather than Netwatch because Netwatch only fires once per status change; the scheduler re-checks
 * every cycle so each failed check triggers another recovery attempt, with a full reboot as a last
 * resort if the tunnel stays down for several minutes.
 */
export const ConnectionWatchdog = {
  /** EC2 server's WireGuard IP — only reachable while the tunnel is up. */
  WatchHost: '10.10.0.1',

  /** Name of the RouterOS scheduler entry this watchdog manages. */
  SchedulerName: 'hc-vpn-watchdog',

  /** Legacy Netwatch entry created by older versions of this tool; removed on re-apply. */
  LegacyNetwatchHost: '10.10.0.1',

  CounterVar: 'hcWatchdogDownCount',

  /**
   * The RouterOS commands that force the WireGuard tunnel to re-handshake. Shared by the scheduler
   * script and the one-shot manual recovery so both behave identically.
   */
  PeerBounceCommands: [
    '/interface wireguard peers set [find] disabled=yes',
    '/interface wireguard peers set [find] disabled=no',
  ] as const,

  /** Installs (or refreshes, idempotently) the VPN-recovery scheduler on the connected router. */
  async apply(client: MikroTikClient, log: (text: string) => void): Promise<void> {
    const v = ConnectionWatchdog.CounterVar
    const onEvent =
      `:global ${v}; ` +
      `:local replies [/ping ${ConnectionWatchdog.WatchHost} count=2]; ` +
      `:if ($replies = 0) do={ ` +
      `:set ${v} ($${v} + 1); ` +
      `/interface wireguard peers set [find] disabled=yes; ` +
      `:delay 3s; ` +
      `/interface wireguard peers set [find] disabled=no; ` +
      `:if ($${v} >= 4) do={ :set ${v} 0; /system reboot }; ` +
      `} else={ ` +
      `:set ${v} 0; ` +
      `};`

    log('')
    log('--- Installing VPN-recovery watchdog (auto-reconnect the tunnel when LTE drops) ---')

    // Remove anything left by previous runs so re-applying stays idempotent.
    await client.run(`/system scheduler remove [find name="${ConnectionWatchdog.SchedulerName}"]`)
    await client.run(`/tool netwatch remove [find host=${ConnectionWatchdog.LegacyNetwatchHost}]`)

    const command =
      `/system scheduler add name="${ConnectionWatchdog.SchedulerName}" interval=30s start-time=startup ` +
      `comment="HikCentral VPN watchdog - re-handshake WG peer when tunnel is down" ` +
      `on-event="${escapeForRouterOsString(onEvent)}"`

    log(`$ ${command}`)
    const output = await client.run(command)
    if (output.trim()) log(output.trimEnd())

    log('The router will now re-establish the VPN tunnel automatically (within ~30s) whenever')
    log('it loses the link to the EC2 server, so the scanner comes back online on its own.')
  },

  /** True if the watchdog scheduler is present in the given '/system scheduler print terse' output. */
  isPresent(schedulerPrintTerseOutput: string): boolean {
    return (
      schedulerPrintTerseOutput.includes(`name=${ConnectionWatchdog.SchedulerName}`) ||
      schedulerPrintTerseOutput.includes(`name="${ConnectionWatchdog.SchedulerName}"`)
    )
  },
}

/** Escapes a RouterOS script snippet so it can be embedded in a double-quoted CLI string argument. */
function escapeForRouterOsString(script: string): string {
  return script.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$')
}
