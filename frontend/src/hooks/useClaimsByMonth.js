import { useCallback, useEffect, useState } from 'react'
import { getClaimsByMonth } from '../api'

export function useClaimsByMonth() {
  const [state, setState] = useState({ status: 'loading', data: null, error: null })

  const fetchData = useCallback(() => {
    let cancelled = false
    setState((s) => ({ ...s, status: 'loading', error: null }))
    getClaimsByMonth()
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', data, error: null })
      })
      .catch((err) => {
        if (!cancelled) setState({ status: 'error', data: null, error: err.message })
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => fetchData(), [fetchData])

  return { ...state, retry: fetchData }
}
