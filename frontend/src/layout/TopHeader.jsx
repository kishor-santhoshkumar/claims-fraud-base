import { useLocation, Link } from 'react-router-dom'
import { ShieldCheck, ChevronRight } from 'lucide-react'
import NotificationBell from '../components/notifications/NotificationBell'
import { useAuth } from '../AuthContext'
import { getInitials } from '../utils/format'
import './TopHeader.css'

function getPageContext(pathname) {
  if (pathname === '/') return { title: 'Dashboard', parent: null }
  if (pathname === '/queue') return { title: 'Provider Queue', parent: null }
  if (pathname === '/analytics') return { title: 'Analytics & Insights', parent: null }
  if (pathname === '/simulation') return { title: 'Simulation Mode', parent: null }
  if (pathname === '/settings') return { title: 'Settings', parent: null }
  if (pathname.startsWith('/case/')) {
    const id = pathname.split('/case/')[1]
    return { title: `Case File ${id}`, parent: 'Queue', parentPath: '/queue' }
  }
  if (pathname.startsWith('/clearance/')) {
    const id = pathname.split('/clearance/')[1]
    return { title: `Clearance ${id}`, parent: 'Queue', parentPath: '/queue' }
  }
  if (pathname.startsWith('/claims/')) {
    const id = pathname.split('/claims/')[1]
    return { title: `Claims Detail ${id}`, parent: 'Queue', parentPath: '/queue' }
  }
  return { title: 'Claims Fraud Detector', parent: null }
}

export default function TopHeader() {
  const location = useLocation()
  const { user } = useAuth()
  const pageCtx = getPageContext(location.pathname)

  return (
    <header className="top-header">
      <div className="top-header-left">
        {pageCtx.parent ? (
          <div className="top-header-breadcrumbs">
            <Link to={pageCtx.parentPath} className="top-header-breadcrumb-link">
              {pageCtx.parent}
            </Link>
            <ChevronRight size={14} className="top-header-breadcrumb-sep" />
            <span className="top-header-title">{pageCtx.title}</span>
          </div>
        ) : (
          <span className="top-header-title">{pageCtx.title}</span>
        )}
      </div>

      <div className="top-header-right">
        <NotificationBell />

        <div className="top-header-divider" />

        <div className="top-header-user">
          <div className="top-header-avatar">{getInitials(user?.name)}</div>
          <span className="top-header-user-name">{user?.name}</span>
        </div>
      </div>
    </header>
  )
}
