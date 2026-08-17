import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Clock,
  DollarSign,
  FileSearch,
  ListChecks,
  RotateCcw,
  ShieldAlert,
} from 'lucide-react'
import { useAuth } from '../AuthContext'
import { useSimulation } from '../SimulationContext'
import { useDecisions } from '../DecisionsContext'
import { getModelInfo } from '../api'
import StatCard from '../components/StatCard'
import ProviderRow from '../components/ProviderRow'
import SimulationGate from '../components/simulation/SimulationGate'
import { formatCurrencyCompact, formatFraudProbability, formatRelativeTime, getGreeting, getTodayLong } from '../utils/format'
import { DECISION_META, DECISION_TYPES } from '../utils/decisions'
import { RISK_TIER_LABEL, getTopRiskSignal } from '../utils/risk'
import './Dashboard.css'

export default function Dashboard() {
  const { user } = useAuth()
  const { status, results, lastRunAt, startSimulation } = useSimulation()
  const firstName = user?.name?.split(' ')[0] || 'Investigator'

  const [modelInfo, setModelInfo] = useState(null)
  useEffect(() => {
    let cancelled = false
    getModelInfo()
      .then((data) => {
        if (!cancelled) setModelInfo(data)
      })
      .catch(() => {
        if (!cancelled) setModelInfo(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="dashboard-page">
      <header className="dashboard-header-row">
        <div>
          <div className="dashboard-console-badge">
            <span className="dashboard-pulse-dot" />
            Fraud Investigation Console
          </div>
          <h1 className="dashboard-greeting">
            {getGreeting()}, {firstName}
          </h1>
          <p className="dashboard-date">{getTodayLong()}</p>
        </div>
        <div className="dashboard-header-actions">
          {status !== 'idle' && (
            <button
              type="button"
              className="sim-rerun-button"
              onClick={startSimulation}
              disabled={status === 'loading'}
            >
              <RotateCcw size={15} />
              Re-run simulation
            </button>
          )}
          <Link to="/queue" className="dashboard-cta">
            Open queue
            <ArrowRight size={16} />
          </Link>
        </div>
      </header>

      <SimulationGate emptyDescription="Run the two-stage cascade against provider feature data to populate this investigation console. Until then, no statistics or case lists below are shown.">
        <DashboardReady results={results} lastRunAt={lastRunAt} />
      </SimulationGate>

      <ModelInfoFooter modelInfo={modelInfo} />
    </div>
  )
}

function DashboardReady({ results, lastRunAt }) {
  const { byProviderId: decisionsByProviderId } = useDecisions()
  const navigate = useNavigate()

  const flaggedResults = useMemo(() => results.filter((r) => r.flagged), [results])
  const highRiskResults = useMemo(() => results.filter((r) => r.riskTier === 'high'), [results])
  const mediumRiskResults = useMemo(() => results.filter((r) => r.riskTier === 'medium'), [results])
  const lowRiskResults = useMemo(() => results.filter((r) => r.riskTier === 'low'), [results])

  const dollarsAtRisk = useMemo(
    () => flaggedResults.reduce((sum, r) => sum + (r.expectedLoss || 0), 0),
    [flaggedResults]
  )

  const topProviders = useMemo(
    () => [...results].sort((a, b) => b.fraud_probability - a.fraud_probability).slice(0, 6),
    [results]
  )

  const decisionStats = useMemo(() => {
    const counts = { confirmed: 0, cleared: 0, escalated: 0 }
    for (const r of results) {
      const d = decisionsByProviderId[r.provider_id]
      if (d && d.decision in counts) counts[d.decision] += 1
    }
    const decided = counts.confirmed + counts.cleared + counts.escalated
    return { ...counts, decided, total: results.length }
  }, [results, decisionsByProviderId])

  // Highest priority cases for investigation (Escalated first, then High Risk unreviewed ordered by exposure)
  const priorityCases = useMemo(() => {
    const escalated = []
    const highRiskUnreviewed = []

    for (const r of results) {
      const d = decisionsByProviderId[r.provider_id]
      if (d && d.decision === 'escalated') {
        escalated.push({ ...r, priorityType: 'escalated', priorityLabel: 'Escalated Case' })
      } else if (!d && r.riskTier === 'high') {
        highRiskUnreviewed.push({ ...r, priorityType: 'high_risk', priorityLabel: 'High Risk Unreviewed' })
      }
    }

    escalated.sort((a, b) => b.fraud_probability - a.fraud_probability)
    highRiskUnreviewed.sort((a, b) => (b.expectedLoss || 0) - (a.expectedLoss || 0))

    return [...escalated, ...highRiskUnreviewed].slice(0, 4)
  }, [results, decisionsByProviderId])

  const totalScored = results.length
  const flaggedPct = totalScored ? ((flaggedResults.length / totalScored) * 100).toFixed(1) : '0'
  const highRiskPct = totalScored ? ((highRiskResults.length / totalScored) * 100).toFixed(1) : '0'

  return (
    <>
      {/* Latest Scoring Run Status Bar */}
      <div className="dashboard-status-bar">
        <div className="dashboard-status-item">
          <span className="dashboard-status-indicator" />
          <span className="dashboard-status-label">Scoring Status:</span>
          <span className="dashboard-status-value">Active ({totalScored} providers scored)</span>
        </div>
        <div className="dashboard-status-divider" />
        <div className="dashboard-status-item">
          <Clock size={13} />
          <span className="dashboard-status-label">Last Scoring Run:</span>
          <span className="dashboard-status-value">
            {lastRunAt ? formatRelativeTime(lastRunAt) : 'Just now'}
          </span>
        </div>
        <div className="dashboard-status-divider" />
        <div className="dashboard-status-item">
          <span className="dashboard-status-label">Cascade Architecture:</span>
          <span className="dashboard-status-value">Stage 1 (RF Gate) → Stage 2 (XGBoost)</span>
        </div>
      </div>

      {decisionStats.escalated > 0 && (
        <div className="dashboard-escalated-callout">
          <AlertTriangle size={16} />
          <span>
            <strong>{decisionStats.escalated}</strong> case{decisionStats.escalated === 1 ? '' : 's'} escalated for senior investigator review
          </span>
          <Link to="/queue" className="dashboard-escalated-link">
            View in queue
            <ArrowRight size={13} />
          </Link>
        </div>
      )}

      {/* 4 KPI Stat Cards */}
      <div className="dashboard-stats">
        <StatCard
          label="Providers scored"
          value={totalScored}
          sublabel={lastRunAt ? `Last run ${formatRelativeTime(lastRunAt)}` : '2-Stage ML Cascade'}
          icon={ListChecks}
          tone="blue"
        />
        <StatCard
          label="Flagged providers"
          value={flaggedResults.length}
          sublabel={`${flaggedPct}% of total scored`}
          icon={ShieldAlert}
          tone="amber"
        />
        <StatCard
          label="High risk providers"
          value={highRiskResults.length}
          sublabel={`${highRiskPct}% of total (prob ≥ 0.70)`}
          icon={AlertTriangle}
          tone="red"
        />
        <StatCard
          label="Expected exposure"
          value={formatCurrencyCompact(dollarsAtRisk)}
          sublabel={`Σ (fraud_prob × billed) flagged`}
          icon={DollarSign}
          tone="blue"
        />
      </div>

      {/* Review Progress & Risk Distribution Grid */}
      <div className="dashboard-middle-grid">
        {/* Risk Distribution Breakdown */}
        <section className="dashboard-card dashboard-risk-dist-card">
          <div className="dashboard-card-header">
            <h2 className="dashboard-card-title">Risk Distribution</h2>
            <span className="dashboard-card-tag">{totalScored} Total Scored</span>
          </div>
          <div className="dashboard-risk-dist-bars">
            <RiskBar
              tierLabel="High Risk (≥ 70%)"
              count={highRiskResults.length}
              total={totalScored}
              tone="red"
            />
            <RiskBar
              tierLabel="Medium Risk (30% - 69%)"
              count={mediumRiskResults.length}
              total={totalScored}
              tone="amber"
            />
            <RiskBar
              tierLabel="Low Risk (< 30%)"
              count={lowRiskResults.length}
              total={totalScored}
              tone="green"
            />
          </div>
        </section>

        {/* Review Progress */}
        <section className="dashboard-card dashboard-review-card">
          <div className="dashboard-card-header">
            <h2 className="dashboard-card-title">Review Progress</h2>
            <Link to="/analytics" className="dashboard-analytics-link">
              <BarChart3 size={13} />
              Analytics
            </Link>
          </div>
          <div className="dashboard-progress-body">
            <div className="dashboard-progress-label">
              <span>Investigator Coverage</span>
              <span>
                {decisionStats.decided} of {decisionStats.total} reviewed (
                {totalScored ? Math.round((decisionStats.decided / totalScored) * 100) : 0}%)
              </span>
            </div>
            <div className="dashboard-progress-track">
              <div
                className="dashboard-progress-fill"
                style={{
                  width: `${totalScored ? (decisionStats.decided / totalScored) * 100 : 0}%`,
                }}
              />
            </div>
            <div className="dashboard-review-subtext">
              <span>{totalScored - decisionStats.decided} cases awaiting decision</span>
            </div>
          </div>
        </section>
      </div>

      {/* Investigation Priority Section */}
      {priorityCases.length > 0 && (
        <section className="dashboard-card dashboard-priority-section">
          <div className="dashboard-card-header">
            <div className="dashboard-card-title-group">
              <ShieldAlert size={17} className="dashboard-priority-icon" />
              <div>
                <h2 className="dashboard-card-title">Investigation Priority</h2>
                <p className="dashboard-card-subtitle">Highest-priority cases requiring immediate review</p>
              </div>
            </div>
            <Link to="/queue" className="dashboard-card-link">
              View all in queue
              <ArrowRight size={13} />
            </Link>
          </div>

          <div className="dashboard-priority-grid">
            {priorityCases.map((item) => (
              <div
                key={item.provider_id}
                className="dashboard-priority-item"
                onClick={() => navigate(`/case/${item.provider_id}`)}
              >
                <div className="dashboard-priority-top">
                  <span
                    className={`dashboard-priority-tag dashboard-priority-tag--${
                      item.priorityType === 'escalated' ? 'escalated' : 'high'
                    }`}
                  >
                    {item.priorityLabel}
                  </span>
                  <span className="dashboard-priority-id">{item.provider_id}</span>
                </div>

                <div className="dashboard-priority-metrics">
                  <div className="dashboard-priority-metric">
                    <span className="dashboard-priority-metric-label">Fraud Probability</span>
                    <span className="dashboard-priority-metric-val dashboard-priority-metric-val--red">
                      {formatFraudProbability(item.fraud_probability)}
                    </span>
                  </div>
                  <div className="dashboard-priority-metric">
                    <span className="dashboard-priority-metric-label">Expected Exposure</span>
                    <span className="dashboard-priority-metric-val">
                      {item.expectedLoss != null ? formatCurrencyCompact(item.expectedLoss) : '—'}
                    </span>
                  </div>
                </div>

                <div className="dashboard-priority-footer">
                  <span className="dashboard-priority-signal">
                    Signal: {getTopRiskSignal(item.provider_id, item)}
                  </span>
                  <button type="button" className="dashboard-priority-btn">
                    Investigate
                    <ArrowRight size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Main Grid: Top Risk Providers Table & Side Column */}
      <div className="dashboard-columns">
        <section className="dashboard-card">
          <div className="dashboard-card-header">
            <h2 className="dashboard-card-title">Top Risk Providers</h2>
            <span className="dashboard-card-tag">Ranked by Fraud Probability</span>
          </div>

          {/* Table Column Headers */}
          <div className="dashboard-table-header">
            <span className="tbl-col-rank">#</span>
            <span className="tbl-col-id">Provider ID</span>
            <span className="tbl-col-decision">Status</span>
            <span className="tbl-col-tier">Risk Tier</span>
            <span className="tbl-col-signal">Top Signal</span>
            <span className="tbl-col-score">Score</span>
            <span className="tbl-col-loss">Exposure</span>
          </div>

          <div className="dashboard-provider-list">
            {topProviders.map((result, i) => (
              <ProviderRow
                key={result.provider_id}
                rank={i + 1}
                result={result}
                decision={decisionsByProviderId[result.provider_id]}
                showSignal={true}
              />
            ))}
          </div>

          <Link to="/queue" className="dashboard-card-link">
            View full queue
            <ArrowRight size={14} />
          </Link>
        </section>

        <div className="dashboard-side-column">
          <section className="dashboard-card">
            <h2 className="dashboard-card-title">Run info</h2>
            <dl className="dashboard-run-info">
              <div className="dashboard-run-info-row">
                <dt>Last run time</dt>
                <dd>{lastRunAt ? new Date(lastRunAt).toLocaleTimeString() : '—'}</dd>
              </div>
              <div className="dashboard-run-info-row">
                <dt>Total providers scored</dt>
                <dd>{results.length}</dd>
              </div>
              <div className="dashboard-run-info-row">
                <dt>Flagged count</dt>
                <dd>{flaggedResults.length}</dd>
              </div>
            </dl>
            <p className="dashboard-run-info-divider">Investigator decisions</p>
            <DecisionCounts results={results} decisionsByProviderId={decisionsByProviderId} />
          </section>

          <RecentActivity decisionsByProviderId={decisionsByProviderId} />
        </div>
      </div>
    </>
  )
}

function RiskBar({ tierLabel, count, total, tone }) {
  const pct = total ? Math.round((count / total) * 100) : 0
  return (
    <div className="dashboard-risk-bar-item">
      <div className="dashboard-risk-bar-top">
        <span className={`dashboard-risk-bar-label dashboard-risk-bar-label--${tone}`}>
          {tierLabel}
        </span>
        <span className="dashboard-risk-bar-val">
          <strong>{count}</strong> ({pct}%)
        </span>
      </div>
      <div className="dashboard-risk-bar-track">
        <div
          className={`dashboard-risk-bar-fill dashboard-risk-bar-fill--${tone}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

function DecisionCounts({ results, decisionsByProviderId }) {
  const counts = { confirmed: 0, cleared: 0, escalated: 0 }
  for (const r of results) {
    const d = decisionsByProviderId[r.provider_id]
    if (d && d.decision in counts) counts[d.decision] += 1
  }
  const decidedCount = counts.confirmed + counts.cleared + counts.escalated
  const unreviewedCount = results.length - decidedCount

  return (
    <dl className="dashboard-run-info">
      {DECISION_TYPES.map((type) => (
        <div className="dashboard-run-info-row" key={type}>
          <dt>{DECISION_META[type].badgeLabel}</dt>
          <dd className={`dashboard-decision-count dashboard-decision-count--${DECISION_META[type].tone}`}>
            {counts[type]}
          </dd>
        </div>
      ))}
      <div className="dashboard-run-info-row">
        <dt>Unreviewed</dt>
        <dd>
          {unreviewedCount} of {results.length}
        </dd>
      </div>
    </dl>
  )
}

function RecentActivity({ decisionsByProviderId }) {
  const allDecisions = useMemo(
    () =>
      Object.values(decisionsByProviderId).sort(
        (a, b) => new Date(b.decided_at) - new Date(a.decided_at)
      ),
    [decisionsByProviderId]
  )
  const recent = allDecisions.slice(0, 5)

  return (
    <section className="dashboard-card">
      <h2 className="dashboard-card-title">Recent activity</h2>
      {recent.length === 0 ? (
        <div className="dashboard-activity-empty">
          <p>No decisions recorded yet.</p>
          <Link to="/queue" className="dashboard-card-link">
            Open queue
            <ArrowRight size={14} />
          </Link>
        </div>
      ) : (
        <>
          <ul className="dashboard-activity-list">
            {recent.map((decision) => {
              const meta = DECISION_META[decision.decision]
              const Icon = meta.icon
              return (
                <li className="dashboard-activity-row" key={`${decision.provider_id}-${decision.decided_at}`}>
                  <span className={`dashboard-activity-icon dashboard-activity-icon--${meta.tone}`}>
                    <Icon size={14} />
                  </span>
                  <span className="dashboard-activity-id">{decision.provider_id}</span>
                  <span className={`dashboard-activity-label dashboard-activity-label--${meta.tone}`}>
                    {meta.badgeLabel}
                  </span>
                  <span className="dashboard-activity-time">
                    <Clock size={11} />
                    {formatRelativeTime(new Date(decision.decided_at).getTime())}
                  </span>
                </li>
              )
            })}
          </ul>
          {allDecisions.length > 5 && (
            <Link to="/queue" className="dashboard-card-link">
              View all
              <ArrowRight size={14} />
            </Link>
          )}
        </>
      )}
    </section>
  )
}

function ModelInfoFooter({ modelInfo }) {
  if (!modelInfo) return null
  return (
    <p className="dashboard-model-footer">
      Model Architecture: {modelInfo.architecture} · {modelInfo.feature_count} features · Gate target recall:{' '}
      {Math.round(modelInfo.gate_target_recall * 100)}% · Trained on{' '}
      {modelInfo.trained_rows.toLocaleString()} providers
    </p>
  )
}
