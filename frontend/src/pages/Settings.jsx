import { useState, useEffect } from 'react'
import {
  Sun,
  Moon,
  Monitor,
  Sliders,
  MonitorCheck,
  Bell,
  User,
  LogOut,
} from 'lucide-react'
import { useAuth } from '../AuthContext'
import { syncGlobalDisplayPreferences } from '../utils/theme'
import { getInitials } from '../utils/format'
import './Settings.css'

const DEFAULT_SETTINGS = {
  investigation: {
    defaultQueueFilter: 'all', // 'all' | 'high'
    autoOpenNextCase: false,
    confirmationBeforeDecision: true,
  },
  appearance: {
    theme: 'system', // 'light' | 'dark' | 'system'
    density: 'comfortable', // 'comfortable' | 'compact'
    enableAnimations: true,
  },
  notifications: {
    highRiskAlerts: true,
    escalationAlerts: true,
    scoringCompletionAlerts: true,
  },
}

export default function Settings() {
  const { user, logout } = useAuth()

  const [settings, setSettings] = useState(() => {
    try {
      const stored = localStorage.getItem('appSettings')
      if (stored) {
        const parsed = JSON.parse(stored)
        return {
          investigation: {
            ...DEFAULT_SETTINGS.investigation,
            ...(parsed.investigation || parsed.investigationPreferences),
          },
          appearance: {
            ...DEFAULT_SETTINGS.appearance,
            ...(parsed.appearance || {}),
          },
          notifications: {
            ...DEFAULT_SETTINGS.notifications,
            ...(parsed.notifications || {}),
          },
        }
      }
    } catch {
      // Fallback to default settings
    }
    return DEFAULT_SETTINGS
  })

  // Sync settings & global theme whenever settings state changes
  useEffect(() => {
    try {
      localStorage.setItem('appSettings', JSON.stringify(settings))
      syncGlobalDisplayPreferences(settings.appearance)
    } catch {
      // Ignore storage errors
    }
  }, [settings])

  function updateSetting(section, key, value) {
    setSettings((prev) => {
      const next = {
        ...prev,
        [section]: {
          ...prev[section],
          [key]: value,
        },
      }
      if (section === 'appearance') {
        syncGlobalDisplayPreferences(next.appearance)
      }
      return next
    })
  }

  return (
    <div className="settings-page">
      <header className="settings-header">
        <div>
          <h1 className="settings-title">Settings</h1>
          <p className="settings-subtitle">Manage preferences and account settings</p>
        </div>
      </header>

      <div className="settings-grid">
        {/* 1. Investigation Section */}
        <SettingsCard
          icon={Sliders}
          title="Investigation"
          description="Workflow and queue defaults"
        >
          <SettingRow
            label="Default queue filter"
            description="Initial filter mode when viewing the provider queue"
          >
            <select
              value={settings.investigation.defaultQueueFilter}
              onChange={(e) => updateSetting('investigation', 'defaultQueueFilter', e.target.value)}
              className="settings-select"
            >
              <option value="all">All Providers</option>
              <option value="high">High Risk Only</option>
            </select>
          </SettingRow>

          <SettingRow
            label="Auto-open next case"
            description="Automatically load the next unreviewed provider after taking action"
          >
            <ToggleSwitch
              checked={!!settings.investigation.autoOpenNextCase}
              onChange={(checked) => updateSetting('investigation', 'autoOpenNextCase', checked)}
              ariaLabel="Auto-open next case"
            />
          </SettingRow>

          <SettingRow
            label="Confirm before decision"
            description="Display a confirmation dialog before recording an investigator decision"
          >
            <ToggleSwitch
              checked={!!settings.investigation.confirmationBeforeDecision}
              onChange={(checked) => updateSetting('investigation', 'confirmationBeforeDecision', checked)}
              ariaLabel="Confirm before decision"
            />
          </SettingRow>
        </SettingsCard>

        {/* 2. Display Section */}
        <SettingsCard
          icon={MonitorCheck}
          title="Display"
          description="Theme, density, and animation options"
        >
          <SettingRow
            label="Theme"
            description="Choose your preferred visual appearance"
          >
            <div className="settings-segmented">
              {[
                { value: 'light', label: 'Light', icon: Sun },
                { value: 'dark', label: 'Dark', icon: Moon },
                { value: 'system', label: 'System', icon: Monitor },
              ].map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  className={`settings-seg-btn${settings.appearance.theme === value ? ' is-active' : ''}`}
                  onClick={() => updateSetting('appearance', 'theme', value)}
                >
                  <Icon size={14} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </SettingRow>

          <SettingRow
            label="Interface density"
            description="Adjust spacing and element scale"
          >
            <div className="settings-segmented">
              {[
                { value: 'comfortable', label: 'Comfortable' },
                { value: 'compact', label: 'Compact' },
              ].map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  className={`settings-seg-btn${settings.appearance.density === value ? ' is-active' : ''}`}
                  onClick={() => updateSetting('appearance', 'density', value)}
                >
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </SettingRow>

          <SettingRow
            label="Animations"
            description="Enable smooth visual transitions and subtle micro-animations"
          >
            <ToggleSwitch
              checked={settings.appearance.enableAnimations !== false}
              onChange={(checked) => updateSetting('appearance', 'enableAnimations', checked)}
              ariaLabel="Enable animations"
            />
          </SettingRow>
        </SettingsCard>

        {/* 3. Notifications Section */}
        <SettingsCard
          icon={Bell}
          title="Notifications"
          description="In-app alert preferences"
        >
          <SettingRow
            label="High-risk provider alerts"
            description="Notify when high-risk providers are scored or flagged"
          >
            <ToggleSwitch
              checked={settings.notifications.highRiskAlerts !== false}
              onChange={(checked) => updateSetting('notifications', 'highRiskAlerts', checked)}
              ariaLabel="High-risk provider alerts"
            />
          </SettingRow>

          <SettingRow
            label="Case escalation alerts"
            description="Notify when cases are escalated for senior review"
          >
            <ToggleSwitch
              checked={settings.notifications.escalationAlerts !== false}
              onChange={(checked) => updateSetting('notifications', 'escalationAlerts', checked)}
              ariaLabel="Case escalation alerts"
            />
          </SettingRow>

          <SettingRow
            label="Scoring completion alerts"
            description="Notify when a batch simulation run completes"
          >
            <ToggleSwitch
              checked={settings.notifications.scoringCompletionAlerts !== false}
              onChange={(checked) => updateSetting('notifications', 'scoringCompletionAlerts', checked)}
              ariaLabel="Scoring completion alerts"
            />
          </SettingRow>
        </SettingsCard>

        {/* 4. Account Section */}
        <SettingsCard
          icon={User}
          title="Account"
          description="Authenticated investigator profile"
        >
          <div className="settings-account-box">
            <div className="settings-account-avatar">
              {getInitials(user?.name)}
            </div>
            <div className="settings-account-details">
              <span className="settings-account-name">{user?.name || 'Investigator User'}</span>
              <span className="settings-account-role">
                Username: {user?.username || 'investigator'}
              </span>
            </div>
            <button
              type="button"
              className="settings-signout-btn"
              onClick={logout}
              title="Sign out of application"
            >
              <LogOut size={15} />
              <span>Sign out</span>
            </button>
          </div>
        </SettingsCard>
      </div>
    </div>
  )
}

function SettingsCard({ icon: Icon, title, description, children }) {
  return (
    <section className="settings-card">
      <div className="settings-card-header">
        <div className="settings-card-icon-box">
          <Icon size={18} />
        </div>
        <div>
          <h2 className="settings-card-title">{title}</h2>
          {description && <p className="settings-card-desc">{description}</p>}
        </div>
      </div>
      <div className="settings-card-body">{children}</div>
    </section>
  )
}

function SettingRow({ label, description, children }) {
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <label className="settings-row-label">{label}</label>
        {description && <p className="settings-row-desc">{description}</p>}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  )
}

function ToggleSwitch({ checked, onChange, ariaLabel }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      className={`toggle-switch${checked ? ' is-on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle-switch-thumb" />
    </button>
  )
}
