import { IpcMainInvokeEvent } from 'electron'
import { LogLevel } from '../shared-types'

/** Creates a logger bound to whichever renderer invoked the IPC call, streaming lines as they happen. */
export function createLogger(event: IpcMainInvokeEvent) {
  const channel = 'workflow:log'
  return (text: string, level: LogLevel = 'info') => {
    if (event.sender.isDestroyed()) return
    event.sender.send(channel, { level, text })
  }
}

/** Runs a command, logs the "$ command" line plus its output, and returns the output. */
export async function runAndShow(
  client: { run: (cmd: string) => Promise<string> },
  log: (text: string, level?: LogLevel) => void,
  label: string,
  command: string,
): Promise<string> {
  log('')
  log(`--- ${label} ---`)
  log(`$ ${command}`, 'cmd')
  const output = await client.run(command)
  if (output.trim()) log(output.trimEnd(), 'output')
  return output
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
