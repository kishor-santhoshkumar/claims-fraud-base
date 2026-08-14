import { useSimulation } from '../../SimulationContext'
import SimulationEmptyState from './SimulationEmptyState'
import SimulationLoadingState from './SimulationLoadingState'
import SimulationErrorState from './SimulationErrorState'

// Shared status-branch used by both Dashboard and Queue so they trigger the
// same startSimulation() (same context, same request) and render identical
// idle/loading/error experiences. Only renders `children` once status is
// 'ready' -- ready-state layout differs per page, so that part stays local.
export default function SimulationGate({ emptyTitle, emptyDescription, loadingSlot, children }) {
  const { status } = useSimulation()

  if (status === 'idle') {
    return <SimulationEmptyState title={emptyTitle} description={emptyDescription} />
  }
  if (status === 'loading') {
    return loadingSlot || <SimulationLoadingState />
  }
  if (status === 'error') {
    return <SimulationErrorState />
  }
  return children
}
