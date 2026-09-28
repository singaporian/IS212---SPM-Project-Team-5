import { authHeaders } from './auth'

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