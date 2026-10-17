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
  // US-010: keep the server's code so the view can recognise a major change (422 MAJOR_CHANGE).
  if (!res.ok) throw Object.assign(new Error(data.error || 'Unable to submit change request.'), { status: res.status, code: data.code, majorChanges: data.majorChanges })
  return data
}

// US-010 (AC-010-004): cancel the approved event and open a new pre-filled draft.
export async function cancelAndResubmit(eventId, changes) {
  const res = await fetch(`/api/events/${eventId}/cancel-and-resubmit`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(changes)
  })
  const data = await res.json()
  if (res.status === 401) throw new Error('Your session has expired. Please sign in again.')
  if (!res.ok) throw new Error(data.error || 'Unable to cancel and resubmit. Please retry.')
  return data
}
// US-032: change requests waiting for the signed-in Event Coordinator's decision.
export async function fetchPendingChangeRequests() {
  const res = await fetch('/api/events/change-requests/pending', { headers: authHeaders() })
  if (res.status === 401) throw new Error('Your session has expired. Please sign in again.')
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Unable to load change requests. Please retry.')
  return data
}

// US-032: approve or reject one change request.
export async function decideChangeRequest(id, decision) {
  let res
  try {
    res = await fetch(`/api/events/change-requests/${id}/decision`, {
      method: 'PATCH',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision })
    })
  } catch {
    throw new Error('Unable to reach the server. Your decision was not saved. Please retry.')
  }
  if (res.status === 401) throw new Error('Your session has expired. Please sign in again.')
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(data.error || 'Unable to save your decision. Please retry.'), { status: res.status })
  return data
}
