export function applyThemePreference(theme) {
  let resolvedTheme = theme
  if (theme === 'system') {
    resolvedTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  document.documentElement.setAttribute('data-theme', resolvedTheme)
}

export function applyDensityPreference(density) {
  document.documentElement.setAttribute('data-density', density || 'comfortable')
}

export function applyAnimationsPreference(enableAnimations) {
  document.documentElement.setAttribute(
    'data-animations',
    enableAnimations !== false ? 'enabled' : 'disabled'
  )
}

export function syncGlobalDisplayPreferences(appearanceSettings) {
  const { theme = 'system', density = 'comfortable', enableAnimations = true } = appearanceSettings || {}
  applyThemePreference(theme)
  applyDensityPreference(density)
  applyAnimationsPreference(enableAnimations)
}
