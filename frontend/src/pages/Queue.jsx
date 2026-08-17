import { useMemo, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  FilterX,
  RotateCcw,
  Search,
  X,
} from 'lucide-react'
import { useSimulation } from '../SimulationContext'
import { useDecisions } from '../DecisionsContext'
import ProviderRow from '../components/ProviderRow'
import SimulationGate from '../components/simulation/SimulationGate'
import { DECISION_META, DECISION_TYPES } from '../utils/decisions'
import './Queue.css'

const RISK_TIERS = [
  { value: 'all', label: 'All Risks' },
  { value: 'high', label: 'High Risk' },
  { value: 'medium', label: 'Medium Risk' },
  { value: 'low', label: 'Low Risk' },
]

const STATUS_FILTERS = ['all', 'unreviewed', ...DECISION_TYPES]

const SORT_OPTIONS = [
  { value: 'fraud_probability_desc', label: 'Fraud Probability (Highest First)' },
  { value: 'fraud_probability_asc', label: 'Fraud Probability (Lowest First)' },
  { value: 'expected_exposure_desc', label: 'Expected Exposure (Highest First)' },
  { value: 'expected_exposure_asc', label: 'Expected Exposure (Lowest First)' },
  { value: 'risk_tier', label: 'Risk Tier (High → Low)' },
  { value: 'decision_status', label: 'Decision Status' },
]

export default function Queue() {
  const { status, results } = useSimulation()
  const location = useLocation()
  const allReviewedMessage = location.state?.message

  return (
    <div className="queue-page">
      <header className="queue-header">
        <div>
          <h1 className="queue-title">Provider Worklist Queue</h1>
          <p className="queue-description">Review, triage, and record investigator decisions on flagged healthcare providers</p>
        </div>
      </header>

      {allReviewedMessage && (
        <div className="queue-banner">
          <CheckCircle2 size={16} />
          {allReviewedMessage}
        </div>
      )}

      <SimulationGate
        emptyTitle="No simulation has been run yet"
        emptyDescription="The provider queue is empty until a simulation is run — real results appear here the moment the backend responds."
      >
        {status === 'loading' ? <QueueSkeletonLoader /> : <QueueReady results={results} />}
      </SimulationGate>
    </div>
  )
}

function QueueReady({ results }) {
  const { byProviderId: decisionsByProviderId } = useDecisions()
  const [searchParams] = useSearchParams()
  const urlRiskParam = searchParams.get('risk')

  const [riskFilter, setRiskFilter] = useState(() => {
    if (urlRiskParam && ['high', 'medium', 'low', 'all'].includes(urlRiskParam)) {
      return urlRiskParam
    }
    try {
      const stored = localStorage.getItem('appSettings')
      if (stored) {
        const parsed = JSON.parse(stored)
        const pref = parsed.investigation?.defaultQueueFilter || parsed.investigationPreferences?.defaultQueueFilter
        if (pref === 'high') return 'high'
      }
    } catch {
      // Fallback
    }
    return 'all'
  })

  const [statusFilter, setStatusFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState('fraud_probability_desc')

  // Search filter by Provider ID
  const searchFiltered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return results
    return results.filter((r) => r.provider_id.toLowerCase().includes(q))
  }, [results, searchQuery])

  // Apply risk filter
  const riskFiltered = useMemo(() => {
    if (riskFilter === 'all') return searchFiltered
    return searchFiltered.filter((r) => r.riskTier === riskFilter)
  }, [searchFiltered, riskFilter])

  // Apply status filter
  const statusFiltered = useMemo(() => {
    if (statusFilter === 'all') return riskFiltered
    if (statusFilter === 'unreviewed') {
      return riskFiltered.filter((r) => !decisionsByProviderId[r.provider_id])
    }
    return riskFiltered.filter((r) => decisionsByProviderId[r.provider_id]?.decision === statusFilter)
  }, [riskFiltered, statusFilter, decisionsByProviderId])

  // Apply sorting
  const sorted = useMemo(() => {
    const copy = [...statusFiltered]
    switch (sortBy) {
      case 'fraud_probability_desc':
        return copy.sort((a, b) => b.fraud_probability - a.fraud_probability)
      case 'fraud_probability_asc':
        return copy.sort((a, b) => a.fraud_probability - b.fraud_probability)
      case 'expected_exposure_desc':
        return copy.sort((a, b) => (b.expectedLoss || 0) - (a.expectedLoss || 0))
      case 'expected_exposure_asc':
        return copy.sort((a, b) => (a.expectedLoss || 0) - (b.expectedLoss || 0))
      case 'risk_tier': {
        const tierOrder = { high: 0, medium: 1, low: 2 }
        return copy.sort((a, b) => (tierOrder[a.riskTier] || 3) - (tierOrder[b.riskTier] || 3))
      }
      case 'decision_status': {
        const statusOrder = { escalated: 0, confirmed: 1, cleared: 2, undefined: 3 }
        return copy.sort((a, b) => {
          const statusA = decisionsByProviderId[a.provider_id]?.decision
          const statusB = decisionsByProviderId[b.provider_id]?.decision
          return (statusOrder[statusA] ?? 3) - (statusOrder[statusB] ?? 3)
        })
      }
      default:
        return copy
    }
  }, [statusFiltered, sortBy, decisionsByProviderId])

  const totalCount = results.length
  const filteredCount = sorted.length
  const hasActiveFilters =
    riskFilter !== 'all' ||
    statusFilter !== 'all' ||
    searchQuery.trim() !== '' ||
    sortBy !== 'fraud_probability_desc'

  function resetFilters() {
    setRiskFilter('all')
    setStatusFilter('all')
    setSearchQuery('')
    setSortBy('fraud_probability_desc')
  }

  return (
    <>
      {/* Search & Filter Controls Bar */}
      <div className="queue-controls-card">
        <div className="queue-search-row">
          <div className="queue-search-wrapper">
            <Search size={15} className="queue-search-icon" />
            <input
              type="text"
              placeholder="Search provider by ID (e.g. PRV54742)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="queue-search-input"
            />
            {searchQuery && (
              <button
                type="button"
                className="queue-search-clear"
                onClick={() => setSearchQuery('')}
                title="Clear search"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div className="queue-sort-control">
            <label htmlFor="queue-sort">Sort by:</label>
            <div className="queue-sort-select-wrapper">
              <select
                id="queue-sort"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="queue-sort-select"
              >
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <ChevronDown size={15} className="queue-sort-icon" />
            </div>
          </div>
        </div>

        {/* Quick Filter Chips */}
        <div className="queue-filter-sections">
          <div className="queue-filters-section">
            <h3 className="queue-filters-title">Risk Level</h3>
            <div className="queue-filters-group">
              {RISK_TIERS.map((tier) => (
                <button
                  key={tier.value}
                  type="button"
                  className={`queue-filter-btn queue-filter-btn--${tier.value}${
                    riskFilter === tier.value ? ' is-active' : ''
                  }`}
                  onClick={() => setRiskFilter(tier.value)}
                >
                  {tier.label}
                </button>
              ))}
            </div>
          </div>

          <div className="queue-filters-section">
            <h3 className="queue-filters-title">Decision Status</h3>
            <div className="queue-filters-group">
              {STATUS_FILTERS.map((filter) => (
                <button
                  key={filter}
                  type="button"
                  className={`queue-filter-btn queue-filter-btn--${filter}${
                    statusFilter === filter ? ' is-active' : ''
                  }`}
                  onClick={() => setStatusFilter(filter)}
                >
                  {filter === 'all'
                    ? 'All'
                    : filter === 'unreviewed'
                    ? 'Pending'
                    : DECISION_META[filter].badgeLabel}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Toolbar & Results Count Header */}
      <div className="queue-toolbar">
        <p className="queue-results-count">
          {filteredCount === totalCount ? (
            <>
              Showing <strong>{filteredCount}</strong> providers
            </>
          ) : (
            <>
              Showing <strong>{filteredCount}</strong> of <strong>{totalCount}</strong> providers
            </>
          )}
        </p>

        {hasActiveFilters && (
          <button type="button" className="queue-reset-btn" onClick={resetFilters}>
            <FilterX size={14} />
            <span>Reset Filters</span>
          </button>
        )}
      </div>

      {/* Responsive Worklist Table Container */}
      <div className="queue-table-card">
        <div className="queue-table-header">
          <span className="tbl-col-rank">#</span>
          <span className="tbl-col-id">Provider</span>
          <span className="tbl-col-decision">Decision</span>
          <span className="tbl-col-tier">Risk</span>
          <span className="tbl-col-signal">Evidence / Signals</span>
          <span className="tbl-col-score">Fraud Prob</span>
          <span className="tbl-col-loss">Expected Exposure</span>
          <span className="tbl-col-action">Action</span>
        </div>

        <div className="queue-table-container">
          {sorted.length === 0 ? (
            <QueueEmptyState
              searchQuery={searchQuery}
              statusFilter={statusFilter}
              onReset={resetFilters}
            />
          ) : (
            sorted.map((result, i) => (
              <ProviderRow
                key={result.provider_id}
                rank={i + 1}
                result={result}
                decision={decisionsByProviderId[result.provider_id] || null}
                showSignal={true}
                showAction={true}
              />
            ))
          )}
        </div>
      </div>
    </>
  )
}

function QueueEmptyState({ searchQuery, statusFilter, onReset }) {
  let title = 'No matching providers found'
  let description = 'No providers match your current filter and search criteria.'

  if (searchQuery.trim()) {
    title = `No provider matching "${searchQuery}"`
    description = 'Double-check the Provider ID and try again, or clear your search.'
  } else if (statusFilter === 'unreviewed') {
    title = 'No pending cases remaining'
    description = 'All cases in this queue have been reviewed and recorded by investigators.'
  }

  return (
    <div className="queue-empty-container">
      <AlertCircle size={28} className="queue-empty-icon" />
      <h3 className="queue-empty-title">{title}</h3>
      <p className="queue-empty-desc">{description}</p>
      <button type="button" className="queue-empty-reset-btn" onClick={onReset}>
        <RotateCcw size={14} />
        <span>Reset All Filters</span>
      </button>
    </div>
  )
}

function QueueSkeletonLoader() {
  return (
    <div className="queue-skeleton-card">
      <div className="queue-skeleton-header" />
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="queue-skeleton-row">
          <div className="queue-skeleton-cell queue-skeleton-rank" />
          <div className="queue-skeleton-cell queue-skeleton-id" />
          <div className="queue-skeleton-cell queue-skeleton-badge" />
          <div className="queue-skeleton-cell queue-skeleton-badge" />
          <div className="queue-skeleton-cell queue-skeleton-text" />
          <div className="queue-skeleton-cell queue-skeleton-score" />
          <div className="queue-skeleton-cell queue-skeleton-loss" />
        </div>
      ))}
    </div>
  )
}
