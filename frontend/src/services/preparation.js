import { authHeaders } from './auth'

// US-021: preparation status API calls.

async function request(url, options, fallback) {
  let res
  try {
    res = await fetch(url, { ...options, headers: { ...authHeaders(), 'Content-Type': 'application/json' } })
  } catch {
    throw new Error(`Unable to reach the server. ${fallback}`)
  }
  if (res.status === 401) throw new Error('Your session has expired. Please sign in again.')
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || fallback)
  return data
}

// Venue Staff: one row per venue booking of a confirmed upcoming event.
export function fetchPreparationBookings() {
  return request('/api/preparation/bookings', {}, 'Unable to load preparation status. Please retry.')
}

// Venue Staff: save the status of one venue booking.
export function savePreparationStatus(id, status) {
  return request(`/api/preparation/bookings/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ status }) },
    'Unable to save preparation status. Please retry.')
}

// Event Coordinator: preparation status of each venue for my events.
export function fetchMyPreparation() {
  return request('/api/preparation/mine', {}, 'Unable to load preparation status. Please retry.')
}
