import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

const NotificationsContext = createContext(null)

const LOCAL_STORAGE_KEY = 'appNotifications'
const SETTINGS_KEY = 'appSettings'

const DEFAULT_SETTINGS = {
  highRiskAlerts: true,
  scoringCompletionAlerts: true,
  escalationAlerts: true,
  decisionSavedAlerts: true,
}

// Initial seed notifications so the system is populated and interactive right away
const INITIAL_NOTIFICATIONS = [
  {
    id: 'notif-seed-1',
    type: 'high_risk',
    title: 'High-risk provider detected',
    message: 'Provider PRV55184 flagged with High Risk (94.2% fraud score)',
    providerId: 'PRV55184',
    targetPath: '/case/PRV55184',
    timestamp: Date.now() - 1000 * 60 * 12, // 12 mins ago
    read: false,
  },
  {
    id: 'notif-seed-2',
    type: 'case_escalated',
    title: 'Case escalated',
    message: 'Provider PRV51001 escalated for senior investigator review',
    providerId: 'PRV51001',
    targetPath: '/case/PRV51001',
    timestamp: Date.now() - 1000 * 60 * 45, // 45 mins ago
    read: false,
  },
  {
    id: 'notif-seed-3',
    type: 'scoring_complete',
    title: 'Scoring run completed',
    message: 'Successfully scored 5,410 healthcare providers in cascade model',
    targetPath: '/simulation',
    timestamp: Date.now() - 1000 * 60 * 120, // 2 hours ago
    read: true,
  },
  {
    id: 'notif-seed-4',
    type: 'decision_saved',
    title: 'Investigator decision saved',
    message: 'Provider PRV52012 marked as Cleared after rule verification',
    providerId: 'PRV52012',
    targetPath: '/case/PRV52012',
    timestamp: Date.now() - 1000 * 60 * 240, // 4 hours ago
    read: true,
  },
]

export function NotificationProvider({ children }) {
  const [notifications, setNotifications] = useState(() => {
    try {
      const stored = localStorage.getItem(LOCAL_STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored)
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed
        }
      }
    } catch {
      // Fall back to initial seed if parse fails
    }
    return INITIAL_NOTIFICATIONS
  })

  // Sync notifications to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(notifications))
    } catch {
      // Ignore storage errors
    }
  }, [notifications])

  // Get current notification settings from localStorage
  const getNotificationPreferences = useCallback(() => {
    try {
      const storedSettings = localStorage.getItem(SETTINGS_KEY)
      if (storedSettings) {
        const parsed = JSON.parse(storedSettings)
        if (parsed && parsed.notifications) {
          return { ...DEFAULT_SETTINGS, ...parsed.notifications }
        }
      }
    } catch {
      // Fall back to defaults
    }
    return DEFAULT_SETTINGS
  }, [])

  // Check if a specific alert type is enabled in settings
  const isTypeEnabled = useCallback(
    (type) => {
      const prefs = getNotificationPreferences()
      switch (type) {
        case 'high_risk':
          return prefs.highRiskAlerts !== false
        case 'scoring_complete':
          return prefs.scoringCompletionAlerts !== false
        case 'case_escalated':
          return prefs.escalationAlerts !== false
        case 'decision_saved':
          return prefs.decisionSavedAlerts !== false
        default:
          return true
      }
    },
    [getNotificationPreferences]
  )

  const addNotification = useCallback(
    ({ type, title, message, providerId, targetPath }) => {
      if (!isTypeEnabled(type)) return

      const newNotif = {
        id: `notif-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        type,
        title,
        message,
        providerId: providerId || null,
        targetPath: targetPath || (providerId ? `/case/${providerId}` : '/queue'),
        timestamp: Date.now(),
        read: false,
      }

      setNotifications((prev) => [newNotif, ...prev])
    },
    [isTypeEnabled]
  )

  const markAsRead = useCallback((id) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    )
  }, [])

  const markAllAsRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
  }, [])

  const removeNotification = useCallback((id) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id))
  }, [])

  const unreadCount = useMemo(() => {
    return notifications.filter((n) => !n.read).length
  }, [notifications])

  const value = useMemo(
    () => ({
      notifications,
      unreadCount,
      addNotification,
      markAsRead,
      markAllAsRead,
      removeNotification,
      getNotificationPreferences,
    }),
    [
      notifications,
      unreadCount,
      addNotification,
      markAsRead,
      markAllAsRead,
      removeNotification,
      getNotificationPreferences,
    ]
  )

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  )
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext)
  if (!ctx) {
    throw new Error('useNotifications must be used within a NotificationProvider')
  }
  return ctx
}
