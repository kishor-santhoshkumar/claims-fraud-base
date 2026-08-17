import { useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { useAuth } from '../AuthContext'
import { useReducedMotion } from '../hooks/useReducedMotion'
import './StartupScreen.css'

const STARTUP_SESSION_KEY = 'cfrd_splash_seen'
const MIN_SPLASH_MS = 1200
const FADE_OUT_MS = 350

export default function StartupScreen() {
  const { status: authStatus } = useAuth()
  const prefersReducedMotion = useReducedMotion()

  const [visible, setVisible] = useState(() => {
    // Show on initial page load / refresh
    return !sessionStorage.getItem(STARTUP_SESSION_KEY)
  })
  const [isFadingOut, setIsFadingOut] = useState(false)

  useEffect(() => {
    if (!visible) return undefined

    const startTime = Date.now()
    let timerId = null
    let fadeOutTimerId = null

    const attemptDismissal = () => {
      // If auth is still checking, wait a bit
      if (authStatus === 'checking') return

      const elapsed = Date.now() - startTime
      const delay = Math.max(0, MIN_SPLASH_MS - elapsed)

      timerId = setTimeout(() => {
        setIsFadingOut(true)
        fadeOutTimerId = setTimeout(() => {
          setVisible(false)
          sessionStorage.setItem(STARTUP_SESSION_KEY, 'true')
        }, FADE_OUT_MS)
      }, delay)
    }

    attemptDismissal()

    // Fallback timer to guarantee dismissal within 1.5s max
    const fallbackTimer = setTimeout(() => {
      if (!isFadingOut) {
        setIsFadingOut(true)
        setTimeout(() => {
          setVisible(false)
          sessionStorage.setItem(STARTUP_SESSION_KEY, 'true')
        }, FADE_OUT_MS)
      }
    }, 1500)

    return () => {
      clearTimeout(timerId)
      clearTimeout(fadeOutTimerId)
      clearTimeout(fallbackTimer)
    }
  }, [authStatus, visible, isFadingOut])

  if (!visible) return null

  return (
    <div
      className={`splash-overlay ${isFadingOut ? 'splash-overlay--fade-out' : ''} ${
        prefersReducedMotion ? 'splash-overlay--reduced-motion' : ''
      }`}
      role="status"
      aria-live="polite"
      aria-label="Initializing fraud detection system"
    >
      <div className="splash-card">
        {/* Logo Container with Orbiting Buffering Ring */}
        <div className="splash-logo-container">
          {/* Outer Circular Buffering Ring (Only this rotates) */}
          <svg className="splash-buffering-ring" viewBox="0 0 120 120" aria-hidden="true">
            <circle
              cx="60"
              cy="60"
              r="52"
              fill="none"
              stroke="rgba(59, 130, 246, 0.15)"
              strokeWidth="4"
            />
            <circle
              cx="60"
              cy="60"
              r="52"
              fill="none"
              stroke="#3b82f6"
              strokeWidth="4"
              strokeDasharray="326"
              strokeDashoffset="210"
              strokeLinecap="round"
              className="splash-buffering-arc"
            />
          </svg>

          {/* Centered Stationary Logo Badge (Does NOT rotate) */}
          <div className="splash-logo-badge">
            <ShieldCheck size={34} color="#ffffff" strokeWidth={2} />
          </div>
        </div>

        {/* Application Name & Loading Status */}
        <h1 className="splash-title">Claims Fraud Intelligence</h1>
        <p className="splash-status">Initializing fraud detection system...</p>
      </div>
    </div>
  )
}
