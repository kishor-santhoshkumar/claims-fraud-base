import { useState, useMemo } from 'react'
import { Link, useNavigate, useParams } from 'react'
import { Link as RouterLink, useNavigate as useRouterNavigate, useParams as useReactParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  DollarSign,
  FileText,
  HelpCircle,
  Info,
  Lightbulb,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  XCircle,
} from 'lucide-react'
import { useSimulation } from '../SimulationContext'
import { useProviderClaims } from '../hooks/useProviderClaims'
import { useProviderEvidence } from '../hooks/useProviderEvidence'
import { useProviderShap } from '../hooks/useProviderShap'
import { useDecisions } from '../DecisionsContext'
import { RISK_TIER_LABEL } from '../utils/risk'
import { formatCurrency, formatCurrencyCompact, formatDateReadable, formatFraudProbability, formatOrdinal, formatRuleId } from '../utils/format'
import { DECISION_META } from '../utils/decisions'
import DecisionBar from '../components/decision/DecisionBar'
import SimulationEmptyState from '../components/simulation/SimulationEmptyState'
import SimulationLoadingState from '../components/simulation/SimulationLoadingState'
import SimulationErrorState from '../components/simulation/SimulationErrorState'
import './ProviderCaseView.css'

const FEATURE_DISPLAY_NAMES = {
  total_reimbursed: 'Total Reimbursed Amount',
  total_claims: 'Total Claims Count',
  inpatient_claims: 'Inpatient Claims Count',
  outpatient_claims: 'Outpatient Claims Count',
  unique_beneficiaries: 'Unique Beneficiaries Count',
  avg_claim_amount: 'Average Claim Amount',
  max_claim_amount: 'Maximum Claim Amount',
  high_risk_diagnosis_count: 'High-Risk Diagnosis Count',
  duplicate_claim_count: 'Duplicate Claims Count',
  inpatient_ratio: 'Inpatient Claim Ratio',
  outpatient_ratio: 'Outpatient Claim Ratio',
  reimbursement_per_beneficiary: 'Reimbursement per Beneficiary',
  claims_per_beneficiary: 'Claims per Beneficiary',
  chronic_condition_ratio: 'Chronic Condition Ratio',
  attending_physician_count: 'Attending Physicians Count',
  operating_physician_count: 'Operating Physicians Count',
  other_physician_count: 'Other Physicians Count',
}

export default function ProviderCaseView({
  title = 'Case File',
  evidenceLabel,
  showClaimsLink = true,
  showRuleEvidence = true,
  showModelSignals = true,
  showDecisionBar = true,
}) {
  const { providerId } = useReactParams()
  const navigate = useRouterNavigate()
  const { status, getResultFor } = useSimulation()
  const claims = useProviderClaims(providerId, { page: 1, limit: 5, enabled: showClaimsLink })
  const evidence = useProviderEvidence(providerId, { enabled: showRuleEvidence })
  const shap = useProviderShap(providerId, { enabled: showModelSignals })

  return (
    <div className="case-view-page">
      {/* 1. Compact Back to Queue Action */}
      <div className="case-view-top-nav">
        <button type="button" className="case-view-back-btn" onClick={() => navigate('/queue')}>
          <ArrowLeft size={15} />
          <span>Back to Queue</span>
        </button>
      </div>

      {status === 'idle' && <SimulationEmptyState />}
      {status === 'loading' && <SimulationLoadingState />}
      {status === 'error' && <SimulationErrorState />}
      {status === 'ready' && (
        <CaseViewReady
          providerId={providerId}
          result={getResultFor(providerId)}
          evidence={evidence}
          shap={shap}
          claims={claims}
          showDecisionBar={showDecisionBar}
        />
      )}
    </div>
  )
}

function CaseViewReady({
  providerId,
  result,
  evidence,
  shap,
  claims,
  showDecisionBar,
}) {
  const { byProviderId: decisionsByProviderId } = useDecisions()
  const decision = decisionsByProviderId[providerId]

  if (!result) {
    return (
      <div className="case-view-missing-card">
        <AlertTriangle size={24} className="case-missing-icon" />
        <h2>Provider Not Scored</h2>
        <p>
          No scoring result exists for provider <code>{providerId}</code> in the current simulation run.
        </p>
        <RouterLink to="/queue" className="case-missing-link">
          Return to Queue
        </RouterLink>
      </div>
    )
  }

  const rulesFiredCount = evidence?.data?.rules_fired ?? 0

  return (
    <div className="case-view-container">
      {/* 1. Provider Risk Summary Header Card */}
      <section className="case-summary-card">
        <div className="case-summary-top-bar">
          <div className="case-summary-identity">
            <span className="case-summary-label">Provider Investigation Case File</span>
            <h1 className="case-summary-id">{providerId}</h1>
          </div>
          <div className="case-summary-status-group">
            <span
              className={`case-summary-decision-badge case-summary-decision-badge--${
                decision ? DECISION_META[decision.decision].tone : 'unreviewed'
              }`}
            >
              {decision ? DECISION_META[decision.decision].badgeLabel : 'Pending Review'}
            </span>
          </div>
        </div>

        <div className="case-summary-metrics-grid">
          {/* Fraud Probability Metric */}
          <div className={`case-metric-box case-metric-box--${result.riskTier}`}>
            <span className="case-metric-label">Fraud Probability</span>
            <div className="case-metric-val-row">
              <span className="case-metric-main-val">
                {formatFraudProbability(result.fraud_probability)}
              </span>
              <span className={`case-risk-tier-badge case-risk-tier-badge--${result.riskTier}`}>
                {RISK_TIER_LABEL[result.riskTier]}
              </span>
            </div>
          </div>

          {/* Expected Exposure Metric */}
          <div className="case-metric-box">
            <span className="case-metric-label">Expected Exposure</span>
            <span className="case-metric-main-val">
              {result.expectedLoss != null ? formatCurrencyCompact(result.expectedLoss) : '—'}
            </span>
            <span className="case-metric-subtext">Σ (fraud_prob × billed)</span>
          </div>

          {/* Triggered Rules Count */}
          <div className="case-metric-box">
            <span className="case-metric-label">Triggered Rules</span>
            <span className="case-metric-main-val">{rulesFiredCount}</span>
            <span className="case-metric-subtext">
              {evidence?.data?.rules_evaluated
                ? `out of ${evidence.data.rules_evaluated} rule checks`
                : 'evaluating checks...'}
            </span>
          </div>

          {/* Flagged Status */}
          <div className="case-metric-box">
            <span className="case-metric-label">Cascade Gate Status</span>
            <div className="case-metric-flag-row">
              {result.flagged ? (
                <ShieldAlert size={18} className="case-flag-icon case-flag-icon--red" />
              ) : (
                <ShieldCheck size={18} className="case-flag-icon case-flag-icon--green" />
              )}
              <span className="case-metric-main-val case-metric-main-val--sm">
                {result.flagged ? 'Flagged for Triage' : 'Passed Gate'}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* 2. Why Was This Provider Flagged Explanation */}
      <WhyFlaggedSection result={result} shap={shap} evidence={evidence} />

      {/* 3. SHAP Model Signals Section */}
      <ModelSignalsSection shap={shap} />

      {/* 4. Rule Findings Section */}
      <RuleEvidenceSection providerId={providerId} evidence={evidence} />

      {/* 5. Claims Evidence Preview Section */}
      <ClaimsEvidencePreviewSection providerId={providerId} claims={claims} />

      {/* 6. Investigator Decision Bar */}
      {showDecisionBar && <DecisionBar providerId={providerId} />}
    </div>
  )
}

/* 2. Plain Language "Why Was This Provider Flagged?" Component */
function WhyFlaggedSection({ result, shap, evidence }) {
  const explanationText = useMemo(() => {
    const shapTop = shap?.data?.top_features ? [...shap.data.top_features].sort((a, b) => Math.abs(b.shap_value) - Math.abs(a.shap_value)).slice(0, 2) : []
    const rulesFired = evidence?.data?.findings || []

    const shapReasons = shapTop
      .filter((f) => f.direction === 'increases_risk')
      .map((f) => {
        const name = FEATURE_DISPLAY_NAMES[f.feature] || f.display_name
        return `${name} (${f.value_formatted})`
      })

    const ruleReasons = rulesFired.slice(0, 2).map((r) => formatRuleId(r.rule_id))

    if (shapReasons.length > 0 || ruleReasons.length > 0) {
      const parts = []
      if (shapReasons.length > 0) {
        parts.push(`Primary risk drivers include elevated ${shapReasons.join(' and ')}`)
      }
      if (ruleReasons.length > 0) {
        parts.push(`Triggered rule checks: ${ruleReasons.join(', ')}`)
      }
      return `${parts.join('. ')}.`
    }

    if (result.riskTier === 'high') {
      return `Provider is flagged due to high continuous fraud probability score (${formatFraudProbability(result.fraud_probability)}) across the 2-stage XGBoost cascade.`
    }
    return `Provider exhibits standard claim patterns with low overall risk indication.`
  }, [result, shap, evidence])

  return (
    <section className="case-card case-why-card">
      <div className="case-why-header">
        <Lightbulb size={18} className="case-why-icon" />
        <h2 className="case-card-title">Why This Provider Was Flagged</h2>
      </div>
      <p className="case-why-explanation">"{explanationText}"</p>
    </section>
  )
}

/* 3. SHAP Model Signals Component */
function ModelSignalsSection({ shap }) {
  const [showAll, setShowAll] = useState(false)
  const { status, data, error, retry } = shap

  if (status === 'loading') {
    return (
      <section className="case-card">
        <h2 className="case-card-title">Model Signals & Feature Attribution (SHAP)</h2>
        <div className="case-skeleton-list">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="case-skeleton-row" />
          ))}
        </div>
      </section>
    )
  }

  if (status === 'error') {
    return (
      <section className="case-card">
        <h2 className="case-card-title">Model Signals & Feature Attribution (SHAP)</h2>
        <div className="case-error-box">
          <AlertTriangle size={16} />
          <span>Model signals unavailable ({error})</span>
          <button type="button" className="case-retry-btn" onClick={retry}>
            <RotateCcw size={13} />
            Retry
          </button>
        </div>
      </section>
    )
  }

  if (status !== 'ready' || !data) return null

  const sortedFeatures = [...data.top_features].sort(
    (a, b) => Math.abs(b.shap_value) - Math.abs(a.shap_value)
  )

  const maxAbsShap = Math.max(...sortedFeatures.map((f) => Math.abs(f.shap_value)), 0.001)
  const visibleFeatures = showAll ? sortedFeatures : sortedFeatures.slice(0, 6)

  return (
    <section className="case-card">
      <div className="case-card-header-row">
        <div>
          <h2 className="case-card-title">Model Signals & Feature Attribution (SHAP)</h2>
          <p className="case-card-subtitle">
            Feature contributions driving this fraud score (Red = Increases Risk, Green = Reduces Risk)
          </p>
        </div>
        {sortedFeatures.length > 6 && (
          <button
            type="button"
            className="case-toggle-all-btn"
            onClick={() => setShowAll((prev) => !prev)}
          >
            {showAll ? (
              <>
                <span>Show top signals only</span>
                <ChevronUp size={14} />
              </>
            ) : (
              <>
                <span>View all {sortedFeatures.length} signals</span>
                <ChevronDown size={14} />
              </>
            )}
          </button>
        )}
      </div>

      <div className="case-shap-list">
        {visibleFeatures.map((f) => {
          const isRisk = f.direction === 'increases_risk'
          const widthPct = (Math.abs(f.shap_value) / maxAbsShap) * 100
          const displayName = FEATURE_DISPLAY_NAMES[f.feature] || f.display_name

          return (
            <div key={f.feature} className="case-shap-row">
              <div className="case-shap-info">
                <div className="case-shap-name-group">
                  <span className={`case-shap-indicator case-shap-indicator--${isRisk ? 'risk' : 'reduce'}`}>
                    {isRisk ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                  </span>
                  <span className="case-shap-feature-name">{displayName}</span>
                  <span className={`case-shap-dir-badge case-shap-dir-badge--${isRisk ? 'risk' : 'reduce'}`}>
                    {isRisk ? '🔴 Increases Risk' : '🟢 Reduces Risk'}
                  </span>
                </div>
                <span className="case-shap-feature-val">{f.value_formatted}</span>
              </div>

              <div className="case-shap-bar-track">
                <div
                  className={`case-shap-bar-fill case-shap-bar-fill--${isRisk ? 'risk' : 'reduce'}`}
                  style={{ width: `${Math.max(widthPct, 2)}%` }}
                />
                {f.percentile != null && (
                  <span className="case-shap-percentile">{formatOrdinal(f.percentile)} percentile</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

/* 4. Rule Findings Component (Grouped by Severity) */
function RuleEvidenceSection({ providerId, evidence }) {
  const { status, data, error, retry } = evidence

  if (status === 'loading') {
    return (
      <section className="case-card">
        <h2 className="case-card-title">Rule Engine Findings</h2>
        <p className="case-loading-text">Loading rule engine findings...</p>
      </section>
    )
  }

  if (status === 'error') {
    return (
      <section className="case-card">
        <h2 className="case-card-title">Rule Engine Findings</h2>
        <div className="case-error-box">
          <AlertTriangle size={16} />
          <span>Rule findings unavailable ({error})</span>
          <button type="button" className="case-retry-btn" onClick={retry}>
            <RotateCcw size={13} />
            Retry
          </button>
        </div>
      </section>
    )
  }

  if (status !== 'ready' || !data) return null

  if (data.rules_fired === 0) {
    return (
      <section className="case-card">
        <div className="case-clean-rule-box">
          <ShieldCheck size={20} className="case-clean-icon" />
          <div>
            <h3 className="case-clean-title">Zero Rules Fired</h3>
            <p className="case-clean-desc">
              Provider passed all {data.rules_evaluated} deterministic rule engine checks cleanly.
            </p>
          </div>
        </div>
      </section>
    )
  }

  // Group findings by severity (Critical, High, Review/Medium)
  const groupedFindings = {
    critical: [],
    high: [],
    review: [],
  }

  for (const finding of data.findings) {
    const sev = (finding.severity || '').toLowerCase()
    if (sev === 'critical') groupedFindings.critical.push(finding)
    else if (sev === 'high') groupedFindings.high.push(finding)
    else groupedFindings.review.push(finding)
  }

  return (
    <section className="case-card">
      <div className="case-card-header-row">
        <div>
          <h2 className="case-card-title">Rule Engine Findings</h2>
          <p className="case-card-subtitle">
            {data.rules_fired} of {data.rules_evaluated} automated compliance rules fired
          </p>
        </div>
      </div>

      <div className="case-rule-groups">
        {groupedFindings.critical.length > 0 && (
          <RuleGroupCategory title="Critical Severity" findings={groupedFindings.critical} providerId={providerId} tone="critical" />
        )}
        {groupedFindings.high.length > 0 && (
          <RuleGroupCategory title="High Severity" findings={groupedFindings.high} providerId={providerId} tone="high" />
        )}
        {groupedFindings.review.length > 0 && (
          <RuleGroupCategory title="Review / Medium Severity" findings={groupedFindings.review} providerId={providerId} tone="review" />
        )}
      </div>
    </section>
  )
}

function RuleGroupCategory({ title, findings, providerId, tone }) {
  return (
    <div className={`case-rule-category case-rule-category--${tone}`}>
      <h3 className="case-rule-category-title">{title} ({findings.length})</h3>
      <div className="case-rule-list">
        {findings.map((finding) => (
          <div key={finding.rule_id} className={`case-rule-card case-rule-card--${tone}`}>
            <div className="case-rule-header">
              <span className="case-rule-name">{formatRuleId(finding.rule_id)}</span>
              <span className={`case-rule-severity-badge case-rule-severity-badge--${tone}`}>
                {finding.severity || tone}
              </span>
            </div>
            <p className="case-rule-summary">{finding.summary}</p>
            <div className="case-rule-footer">
              <span className="case-rule-citation">
                Policy Citation: {finding.citation || 'CMS Compliance Standard'}
              </span>
              {finding.matching_claim_ids && finding.matching_claim_ids.length > 0 && (
                <RouterLink
                  to={`/claims/${providerId}?claimIds=${finding.matching_claim_ids.join(',')}&ruleLabel=${encodeURIComponent(formatRuleId(finding.rule_id))}`}
                  className="case-rule-claims-link"
                >
                  <span>View {finding.matching_claim_ids.length} related claim{finding.matching_claim_ids.length === 1 ? '' : 's'}</span>
                  <ArrowRight size={12} />
                </RouterLink>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* 5. Claims Evidence Preview Component */
function ClaimsEvidencePreviewSection({ providerId, claims }) {
  const { status, data } = claims

  return (
    <section className="case-card">
      <div className="case-card-header-row">
        <div>
          <h2 className="case-card-title">Claims Evidence Preview</h2>
          <p className="case-card-subtitle">
            {status === 'ready' && data ? `Showing recent claims out of ${data.total_claims.toLocaleString()} total claims` : 'Claim-level evidence details'}
          </p>
        </div>
        {status === 'ready' && data && (
          <RouterLink to={`/claims/${providerId}`} className="case-view-all-claims-btn">
            <span>View All {data.total_claims.toLocaleString()} Claims</span>
            <ArrowRight size={14} />
          </RouterLink>
        )}
      </div>

      {status === 'loading' && <p className="case-loading-text">Loading claims preview...</p>}

      {status === 'ready' && data && (
        <div className="case-claims-preview-table-wrap">
          <table className="case-claims-table">
            <thead>
              <tr>
                <th>Claim ID</th>
                <th>Dates</th>
                <th>Type</th>
                <th>Amount Reimbursed</th>
                <th>Rule / Evidence Status</th>
              </tr>
            </thead>
            <tbody>
              {data.claims.map((c) => {
                const hasFlags = c.rule_flags && c.rule_flags.length > 0
                return (
                  <tr key={c.claim_id} className={hasFlags ? 'case-claim-row--flagged' : ''}>
                    <td className="case-claim-cell-id">{c.claim_id}</td>
                    <td>{formatDateReadable(c.claim_start_dt)}</td>
                    <td>
                      <span className={`case-type-badge case-type-badge--${c.claim_type}`}>
                        {c.claim_type}
                      </span>
                    </td>
                    <td className="case-claim-cell-amount">{formatCurrency(c.amount_reimbursed)}</td>
                    <td>
                      {hasFlags ? (
                        <span className="case-claim-flag-tag">
                          Matched {c.rule_flags.length} Rule{c.rule_flags.length === 1 ? '' : 's'}
                        </span>
                      ) : (
                        <span className="case-claim-clean-tag">Clean Claim</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
