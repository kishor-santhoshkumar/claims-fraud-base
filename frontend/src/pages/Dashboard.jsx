import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowRight, DollarSign, ListChecks, RotateCcw } from 'lucide-react'
import { useAuth } from '../AuthContext'
import { useSimulation } from '../SimulationContext'
import { useDecisions } from '../DecisionsContext'
import StatCard from '../components/StatCard'
import ProviderRow from '../components/ProviderRow'
import SimulationGate from '../components/simulation/SimulationGate'
import { formatCurrencyCompact, getGreeting, getTodayLong } from '../utils/format'
import { DECISION_META, DECISION_TYPES } from '../utils/decisions'
import './Dashboard.css'

export default function Dashboard() {
  const { user } = useAuth()
  const { status, results, lastRunAt, startSimulation } = useSimulation()

  const firstName = user?.name?.split(' ')[0] || 'there'

  return (
    <div className="dashboard-page">
      <header className="dashboard-header-row">
        <div>
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

      <SimulationGate emptyDescription="Run the two-stage cascade against real provider feature data to populate this dashboard. Until then, no stats or lists below are shown.">
        <DashboardReady results={results} lastRunAt={lastRunAt} />
      </SimulationGate>
    </div>
  )
}

function DashboardReady({ results, lastRunAt }) {
  const { byProviderId: decisionsByProviderId } = useDecisions()
  const flaggedResults = results.filter((r) => r.flagged)
  const highRiskCount = results.filter((r) => r.riskTier === 'high').length
  const dollarsAtRisk = flaggedResults.reduce(
    (sum, r) => sum + (r.expectedLoss || 0),
    0
  )
  const topProviders = [...results]
    .sort((a, b) => b.fraud_probability - a.fraud_probability)
    .slice(0, 5)

  return (
    <>
      <div className="dashboard-stats">
        <StatCard label="Providers scored" value={results.length} icon={ListChecks} tone="blue" />
        <StatCard
          label="Flagged"
          value={flaggedResults.length}
          sublabel={`of ${results.length} scored`}
          icon={AlertTriangle}
          tone="amber"
        />
        <StatCard
          label="High risk providers"
          value={highRiskCount}
          sublabel="fraud_probability ≥ 0.7"
          icon={AlertTriangle}
          tone="red"
        />
        <StatCard
          label="Dollars at risk"
          value={formatCurrencyCompact(dollarsAtRisk)}
          sublabel="Σ (fraud_probability × billed), flagged only"
          icon={DollarSign}
          tone="blue"
        />
      </div>

      <div className="dashboard-columns">
        <section className="dashboard-card">
          <h2 className="dashboard-card-title">Top risk providers</h2>
          <div className="dashboard-provider-list">
            {topProviders.map((result, i) => (
              <ProviderRow key={result.provider_id} rank={i + 1} result={result} />
            ))}
          </div>
          <Link to="/queue" className="dashboard-card-link">
            View full queue
            <ArrowRight size={14} />
          </Link>
        </section>

        <section className="dashboard-card">
          <h2 className="dashboard-card-title">Run info</h2>
          <dl className="dashboard-run-info">
            <div className="dashboard-run-info-row">
              <dt>Last run</dt>
              <dd>{lastRunAt ? new Date(lastRunAt).toLocaleTimeString() : '—'}</dd>
            </div>
            <div className="dashboard-run-info-row">
              <dt>Providers scored</dt>
              <dd>{results.length}</dd>
            </div>
            <div className="dashboard-run-info-row">
              <dt>Flagged</dt>
              <dd>{flaggedResults.length}</dd>
            </div>
          </dl>
          <p className="dashboard-run-info-divider">Investigator decisions</p>
          <DecisionCounts results={results} decisionsByProviderId={decisionsByProviderId} />
        </section>
      </div>
    </>
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
