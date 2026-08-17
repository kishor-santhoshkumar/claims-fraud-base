import { useNavigate } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { RISK_TIER_LABEL, getTopRiskSignal } from '../utils/risk'
import { formatCurrencyCompact, formatFraudProbability } from '../utils/format'
import { DECISION_META } from '../utils/decisions'
import './ProviderRow.css'

export default function ProviderRow({
  rank,
  result,
  decision,
  showSignal = false,
  showAction = false,
}) {
  const navigate = useNavigate()
  const showDecisionColumn = decision !== undefined
  const topSignal = showSignal ? getTopRiskSignal(result.provider_id, result) : null

  return (
    <div
      className={`provider-row${showDecisionColumn ? ' provider-row--with-decision' : ''}${
        showSignal ? ' provider-row--with-signal' : ''
      }${showAction ? ' provider-row--with-action' : ''}`}
      onClick={() => navigate(`/case/${result.provider_id}`)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          navigate(`/case/${result.provider_id}`)
        }
      }}
    >
      <span className="provider-row-rank">{rank}</span>
      <span className="provider-row-id">{result.provider_id}</span>

      {showDecisionColumn && (
        <span
          className={`provider-row-decision provider-row-decision--${
            decision ? DECISION_META[decision.decision].tone : 'unreviewed'
          }`}
        >
          {decision ? DECISION_META[decision.decision].badgeLabel : 'Pending'}
        </span>
      )}

      <span className={`provider-row-badge provider-row-badge--${result.riskTier}`}>
        {RISK_TIER_LABEL[result.riskTier]}
      </span>

      {showSignal && <span className="provider-row-signal">{topSignal}</span>}

      <span className="provider-row-score">{formatFraudProbability(result.fraud_probability)}</span>
      <span className="provider-row-loss">
        {result.expectedLoss != null ? formatCurrencyCompact(result.expectedLoss) : '—'}
      </span>

      {showAction && (
        <button
          type="button"
          className="provider-row-open-btn"
          onClick={(e) => {
            e.stopPropagation()
            navigate(`/case/${result.provider_id}`)
          }}
          title={`Open case file for ${result.provider_id}`}
        >
          <span>Open Case</span>
          <ArrowRight size={12} />
        </button>
      )}
    </div>
  )
}
