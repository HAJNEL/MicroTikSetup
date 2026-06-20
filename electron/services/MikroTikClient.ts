import { Client as SshClient } from 'ssh2'

/** Thin wrapper around an SSH session to a MikroTik RouterOS device. */
export class MikroTikClient {
  private client: SshClient | null = null
  private connected = false

  constructor(
    private readonly host: string,
    private readonly username: string,
    private readonly password: string,
  ) {}

  connect(timeoutMs = 15000): Promise<void> {
    return new Promise((resolve, reject) => {
      const client = new SshClient()
      const timer = setTimeout(() => {
        client.end()
        reject(new Error('Connection timed out'))
      }, timeoutMs)

      client
        .on('ready', () => {
          clearTimeout(timer)
          this.client = client
          this.connected = true
          resolve()
        })
        .on('error', (err) => {
          clearTimeout(timer)
          reject(err)
        })
        .connect({
          host: this.host,
          port: 22,
          username: this.username,
          password: this.password,
          readyTimeout: timeoutMs,
          // RouterOS sometimes only offers older algorithms on default config.
          algorithms: {
            kex: [
              'diffie-hellman-group14-sha256',
              'diffie-hellman-group14-sha1',
              'diffie-hellman-group1-sha1',
              'diffie-hellman-group-exchange-sha256',
            ],
          },
        })
    })
  }

  get isConnected(): boolean {
    return this.connected && this.client !== null
  }

  /** Runs a single RouterOS CLI command and returns its combined output. */
  run(command: string, timeoutMs = 30000): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.client || !this.connected) {
        reject(new Error('Not connected to the MikroTik router.'))
        return
      }
      const client = this.client
      let settled = false
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true
          reject(new Error(`Command timed out: ${command}`))
        }
      }, timeoutMs)

      client.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(timer)
          if (!settled) {
            settled = true
            reject(err)
          }
          return
        }
        let stdout = ''
        let stderr = ''
        stream
          .on('close', () => {
            clearTimeout(timer)
            if (settled) return
            settled = true
            resolve(stderr ? `${stdout}\n[stderr] ${stderr}` : stdout)
          })
          .on('data', (data: Buffer) => {
            stdout += data.toString('utf8')
          })
          .stderr.on('data', (data: Buffer) => {
            stderr += data.toString('utf8')
          })
      })
    })
  }

  disconnect(): void {
    if (this.client && this.connected) {
      this.client.end()
    }
    this.connected = false
  }
}
