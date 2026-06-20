import React from 'react'
import { SshCredentials } from '../types'

interface Props {
  value: SshCredentials
  onChange: (value: SshCredentials) => void
  disabled?: boolean
}

export default function CredentialsForm({ value, onChange, disabled }: Props) {
  return (
    <div className="row">
      <div className="field">
        <label>Router IP to connect to</label>
        <input
          value={value.routerIp}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, routerIp: e.target.value })}
          placeholder="192.168.88.1"
        />
      </div>
      <div className="field">
        <label>SSH username</label>
        <input
          value={value.username}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, username: e.target.value })}
          placeholder="admin"
        />
      </div>
      <div className="field">
        <label>SSH password</label>
        <input
          type="password"
          value={value.password}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, password: e.target.value })}
        />
      </div>
    </div>
  )
}
