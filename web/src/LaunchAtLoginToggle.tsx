import { useEffect, useState } from 'react';
import type { LaunchAtLogin } from '../../shared/bridge';
import { api } from './api';

export function LaunchAtLoginToggle() {
  const [setting, setSetting] = useState<LaunchAtLogin | null>(null);
  useEffect(() => {
    api.launchAtLogin().then(setSetting);
  }, []);
  if (!setting) return null;

  return (
    <label
      className="login-toggle"
      title={setting.available ? undefined : 'Available in the installed app'}
    >
      <input
        type="checkbox"
        checked={setting.enabled}
        disabled={!setting.available}
        onChange={(e) => api.setLaunchAtLogin(e.target.checked).then(setSetting)}
      />
      Start Flow when I sign in to Windows
    </label>
  );
}
