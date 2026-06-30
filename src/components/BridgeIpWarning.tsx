export default function BridgeIpWarning({ mikroTikLanIp }: { mikroTikLanIp: string }) {
  return (
    <div className="banner warn banner-top">
      ⚠ The router's LAN IP doesn't match this site's expected address (<code>{mikroTikLanIp}</code>). This is
      usually why devices have no internet and the router can only be reached in WinBox via its MAC address
      (Neighbors tab), not by IP. Connect that way, then run <code>/ip address print</code> to find the bridge
      entry and <code>{`/ip address set 0 address=${mikroTikLanIp}/24`}</code> to fix it (replace <code>0</code>{' '}
      with the correct entry number if different).
    </div>
  )
}
