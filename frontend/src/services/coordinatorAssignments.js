import { authHeaders } from './auth'

// US-034: Event Coordinator Lead assignment workflow. Errors keep the server's message and status.
async function request(url, options = {}, fallback) {
  let response
  try {
    response = await fetch(url, { ...options, headers: { ...authHeaders(), ...(options.body ? { 'Content-Type': 'application/json' } : {}) } })
  } catch {
    throw new Error('Unable to reach the server. Check your connection and retry.')
  }
  if (response.status === 401) throw Object.assign(new Error('Your session has expired. Sign in again to continue.'), { status: 401 })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw Object.assign(new Error(data.error || fallback), { status: response.status })
  return data
}

export function getAssignmentOverview() {
  return request('/api/coordinator-lead/overview', {}, 'Unable to load coordinator assignments. Please retry.')
}

// currentCoordinatorId is who the Lead saw on the request (null for the unassigned queue).
export function assignCoordinator(eventId, coordinatorId, currentCoordinatorId) {
  return request(`/api/coordinator-lead/events/${encodeURIComponent(eventId)}/coordinator`, {
    method: 'PATCH',
    body: JSON.stringify({ coordinatorId, currentCoordinatorId })
  }, 'Unable to save the assignment. Please retry.')
}
