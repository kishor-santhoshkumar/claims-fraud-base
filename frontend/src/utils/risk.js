import providersRaw from '../data/providers_raw.json'
import { formatFraudProbability } from './format'

// Risk-tier display convention. This is a FRONTEND-ONLY convention for
// grouping/coloring providers in the UI -- the backend never returns a
// tier, only a continuous fraud_probability. These thresholds are not a
// backend contract and can be changed here without touching the API.
export const RISK_TIER_THRESHOLDS = { high: 0.7, medium: 0.4 }

export function getRiskTier(fraudProbability) {
  if (fraudProbability >= RISK_TIER_THRESHOLDS.high) return 'high'
  if (fraudProbability >= RISK_TIER_THRESHOLDS.medium) return 'medium'
  return 'low'
}

export const RISK_TIER_LABEL = {
  high: 'High risk',
  medium: 'Medium risk',
  low: 'Low risk',
}

const rawById = new Map(providersRaw.map((p) => [p.provider_id, p]))

export function getTopRiskSignal(providerId, result) {
  const raw = rawById.get(providerId)
  if (!raw) {
    if (result && result.fraud_probability >= 0.7) return 'High Fraud Probability'
    return 'Cascade Scored'
  }
  if (raw.duplicate_claim_count && raw.duplicate_claim_count > 0) {
    return `${raw.duplicate_claim_count} Duplicate Claim${raw.duplicate_claim_count > 1 ? 's' : ''}`
  }
  if (raw.high_risk_diagnosis_count && raw.high_risk_diagnosis_count > 5) {
    return `${raw.high_risk_diagnosis_count} High-Risk Diagnoses`
  }
  if (raw.inpatient_claims && raw.inpatient_claims > 20) {
    return `High Inpatient Vol (${raw.inpatient_claims})`
  }
  if (raw.avg_claim_amount && raw.avg_claim_amount > 4000) {
    return `High Avg Claim ($${Math.round(raw.avg_claim_amount)})`
  }
  if (result && result.fraud_probability >= 0.7) {
    return `Cascade Score ${formatFraudProbability(result.fraud_probability)}`
  }
  if (raw.total_claims && raw.total_claims > 100) {
    return `High Claim Volume (${raw.total_claims})`
  }
  return 'Standard Risk Pattern'
}
