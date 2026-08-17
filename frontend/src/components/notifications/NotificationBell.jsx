import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Bell,
  CheckCheck,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  Clock,
  X,
  ExternalLink,
  Inbox,
} from 'lucide-react'
import { useNotifications } from '../../NotificationsContext'
import { formatRelativeTime } from '../../utils/format'
import './NotificationBell.css'

const NOTIF_ICONS = {
  high_risk: { icon: AlertTriangle, tone: 'danger', color: '#ef4444' },
  scoring_complete: { icon: CheckCircle2, tone: 'blue', color: '#2563eb' },
  case_escalated: { icon: AlertCircle, tone: 'warning', color: '#f59e0b' },
  decision_saved: { icon: ShieldCheck, tone: 'success', color: '#10b981' },
}

export default function NotificationBell() {
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications()
  const [isOpen, setIsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState('all') // 'all' | 'unread'
  const panelRef = useRef(null)
  const navigate = useNavigate()

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event) {
      if (panelRef.current && !panelRef.current.contains(event.target)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  // Filter notifications based on tab
  const displayedNotifications = notifications.filter((n) => {
    if (activeTab === 'unread') return !n.read
    return true
  })

  function handleItemClick(notif) {
    markAsRead(notif.id)
    setIsOpen(false)
    if (notif.targetPath) {
      navigate(notif.targetPath)
    }
  }

  return (
    <div className="notif-wrapper" ref={panelRef}>
      <button
        type="button"
        className={`notif-bell-btn${isOpen ? ' is-active' : ''}${unreadCount > 0 ? ' has-unread' : ''}`}
        onClick={() => setIsOpen((prev) => !prev)}
        title="Notifications"
        aria-label={`Notifications (${unreadCount} unread)`}
      >
        <Bell size={18} className="notif-bell-icon" />
        {unreadCount > 0 && (
          <span className="notif-badge" aria-hidden="true">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="notif-dropdown">
          <header className="notif-dropdown-header">
            <div className="notif-header-title-row">
              <h3 className="notif-header-title">Notifications</h3>
              {unreadCount > 0 && (
                <span className="notif-unread-tag">{unreadCount} new</span>
              )}
            </div>

            <div className="notif-header-actions">
              <button
                type="button"
                className="notif-mark-all-btn"
                onClick={markAllAsRead}
                disabled={unreadCount === 0}
                title="Mark all as read"
              >
                <CheckCheck size={14} />
                <span>Mark all read</span>
              </button>
              <button
                type="button"
                className="notif-close-btn"
                onClick={() => setIsOpen(false)}
                title="Close panel"
              >
                <X size={15} />
              </button>
            </div>
          </header>

          <div className="notif-tabs">
            <button
              type="button"
              className={`notif-tab${activeTab === 'all' ? ' is-active' : ''}`}
              onClick={() => setActiveTab('all')}
            >
              All ({notifications.length})
            </button>
            <button
              type="button"
              className={`notif-tab${activeTab === 'unread' ? ' is-active' : ''}`}
              onClick={() => setActiveTab('unread')}
            >
              Unread ({unreadCount})
            </button>
          </div>

          <div className="notif-list">
            {displayedNotifications.length === 0 ? (
              <div className="notif-empty-state">
                <Inbox size={28} className="notif-empty-icon" />
                <p className="notif-empty-text">
                  {activeTab === 'unread'
                    ? 'No unread notifications'
                    : 'No notifications yet'}
                </p>
              </div>
            ) : (
              displayedNotifications.map((n) => {
                const meta = NOTIF_ICONS[n.type] || NOTIF_ICONS.high_risk
                const IconComponent = meta.icon

                return (
                  <div
                    key={n.id}
                    className={`notif-item${!n.read ? ' is-unread' : ''}`}
                    onClick={() => handleItemClick(n)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        handleItemClick(n)
                      }
                    }}
                  >
                    <div className={`notif-icon-box notif-icon-box--${meta.tone}`}>
                      <IconComponent size={15} color={meta.color} />
                    </div>

                    <div className="notif-item-body">
                      <div className="notif-item-header">
                        <span className="notif-item-title">{n.title}</span>
                        {!n.read && <span className="notif-unread-dot" title="Unread" />}
                      </div>

                      <p className="notif-item-msg">{n.message}</p>

                      <div className="notif-item-footer">
                        <span className="notif-item-time">
                          <Clock size={11} />
                          {formatRelativeTime(n.timestamp)}
                        </span>
                        {n.providerId && (
                          <span className="notif-provider-tag">
                            {n.providerId}
                          </span>
                        )}
                        <ExternalLink size={11} className="notif-item-link-icon" />
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
