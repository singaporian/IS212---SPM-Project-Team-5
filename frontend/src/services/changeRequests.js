import { authHeaders } from './auth'

// US-008 (AC-008-001): change requests only apply once the Coordinator has approved the event.
// Must match CHANGE_REQUEST_STATUSES in backend/src/domain/index.js.
export const CHANGE_REQUEST_STATUSES = ['planning', 'confirmed']

export function canRequestChanges(status) {
  return CHANGE_REQUEST_STATUSES.includes(status)
}

export async function fetchSubmittedRequest(eventId) {
  const res = await fetch(`/api/requests/${encodeURIComponent(eventId)}`, { headers: authHeaders() })
  if (res.status === 401) throw new Error('Your session has expired. Please sign in again.')
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Unable to load this request.')
  return data
}

export async function fetchMyEvents() {
  const res = await fetch('/api/events/mine', { headers: authHeaders() })
  if (res.status === 401) throw new Error('Your session has expired. Please sign in again.')
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Unable to load your event requests.')
  return data
}

export async function submitChangeRequest(eventId, changes) {
  const res = await fetch(`/api/events/${eventId}/change-requests`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(changes)
  })
  const data = await res.json()
  if (res.status === 401) throw new Error('Your session has expired. Please sign in again.')
  if (!res.ok) throw new Error(data.error || 'Unable to submit change request.')
  return data
}