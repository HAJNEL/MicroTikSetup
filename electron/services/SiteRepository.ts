import fs from 'node:fs'
import { SiteRecord, NextSiteSuggestion, emptySite } from '../shared-types'

/** Stores configured-site records in a CSV file next to the app's user data. */
export class SiteRepository {
  constructor(private readonly path: string) {}

  loadAll(): SiteRecord[] {
    if (!fs.existsSync(this.path)) return []
    const lines = fs.readFileSync(this.path, 'utf8').split(/\r?\n/)
    const records: SiteRecord[] = []
    for (let i = 1; i < lines.length; i++) {
      // skip header
      if (!lines[i] || !lines[i].trim()) continue
      records.push(fromCsvLine(lines[i]))
    }
    return records
  }

  append(record: SiteRecord): void {
    const writeHeader = !fs.existsSync(this.path)
    const lines: string[] = []
    if (writeHeader) lines.push(header())
    lines.push(toCsvLine(record))
    fs.appendFileSync(this.path, lines.join('\n') + '\n', 'utf8')
  }

  upsert(record: SiteRecord): void {
    const all = this.loadAll()
    const idx = all.findIndex((r) => r.siteName.toLowerCase() === record.siteName.toLowerCase())
    if (idx >= 0) {
      all[idx] = record
      this.saveAll(all)
    } else {
      this.append(record)
    }
  }

  saveAll(records: SiteRecord[]): void {
    const lines = [header(), ...records.map(toCsvLine)]
    fs.writeFileSync(this.path, lines.join('\n') + '\n', 'utf8')
  }

  /**
   * Suggests the next free site numbering based on existing records.
   * WireGuard IP 10.10.0.N pairs with LAN subnet 192.168.(86+N).0/24
   * (Site 1 -> .2 -> 88, Site 2 -> .3 -> 89, Site 3 -> .4 -> 90, ...).
   */
  suggestNext(): NextSiteSuggestion {
    const records = this.loadAll()
    let maxWg = 1 // EC2 server itself is .1, first site is .2
    for (const r of records) {
      const octet = lastOctet(r.wireGuardIp)
      if (octet !== null && octet > maxWg) maxWg = octet
    }
    const nextWg = maxWg + 1
    const nextLanThird = nextWg + 86
    return { wgOctet: nextWg, lanThirdOctet: nextLanThird }
  }

  siteNameExists(siteName: string): boolean {
    return this.loadAll().some((r) => r.siteName.toLowerCase() === siteName.toLowerCase())
  }

  lanSubnetInUse(lanSubnet: string): boolean {
    return this.loadAll().some((r) => r.lanSubnet.toLowerCase() === lanSubnet.toLowerCase())
  }
}

function header(): string {
  return 'SiteName,WireGuardIp,LanSubnet,MikroTikLanIp,DeviceIp,DeviceGateway,MikroTikPublicKey,DateConfigured,LastCheckResults'
}

function escape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return '"' + value.replace(/"/g, '""') + '"'
  }
  return value
}

function toCsvLine(r: SiteRecord): string {
  return [
    r.siteName,
    r.wireGuardIp,
    r.lanSubnet,
    r.mikroTikLanIp,
    r.deviceIp,
    r.deviceGateway,
    r.mikroTikPublicKey,
    r.dateConfigured,
    r.lastCheckResults ?? '',
  ]
    .map(escape)
    .join(',')
}

function splitCsvLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        current += '"'
        i++
      } else if (c === '"') {
        inQuotes = false
      } else {
        current += c
      }
    } else {
      if (c === '"') inQuotes = true
      else if (c === ',') {
        result.push(current)
        current = ''
      } else current += c
    }
  }
  result.push(current)
  return result
}

function fromCsvLine(line: string): SiteRecord {
  const parts = splitCsvLine(line)
  const get = (i: number) => parts[i] ?? ''
  const site = emptySite()
  site.siteName = get(0)
  site.wireGuardIp = get(1)
  site.lanSubnet = get(2)
  site.mikroTikLanIp = get(3)
  site.deviceIp = get(4)
  site.deviceGateway = get(5)
  site.mikroTikPublicKey = get(6)
  site.dateConfigured = get(7)
  site.lastCheckResults = get(8) || undefined
  return site
}

function lastOctet(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  const n = parseInt(parts[3], 10)
  return Number.isNaN(n) ? null : n
}

/** Converts a CIDR subnet like "192.168.90.0/24" to a dotted subnet mask like "255.255.255.0". */
export function cidrToSubnetMask(cidrSubnet: string): string {
  const parts = cidrSubnet.split('/')
  if (parts.length !== 2) return cidrSubnet
  const prefixLength = parseInt(parts[1], 10)
  if (Number.isNaN(prefixLength) || prefixLength < 0 || prefixLength > 32) return cidrSubnet
  const mask = prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0
  return [(mask >>> 24) & 0xff, (mask >>> 16) & 0xff, (mask >>> 8) & 0xff, mask & 0xff].join('.')
}
