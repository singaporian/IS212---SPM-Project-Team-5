import { authHeaders } from './auth'

export async function createEquipment(payload) {
  const response = await fetch('/api/equipment', {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  if (response.status === 401) throw new Error('Your session has expired. Sign in in another tab, then retry here to keep your input.')
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Unable to save the equipment record. Please retry.')
  return data
}

// US-023: equipment reservations. Errors keep the server's message (including conflict details).
async function request(url, options = {}, fallback) {
  let response
  try {
    response = await fetch(url, { ...options, headers: { ...authHeaders(), ...(options.body ? { 'Content-Type': 'application/json' } : {}) } })
  } catch {
    throw new Error('Unable to reach the server. Check your connection and retry.')
  }
  if (response.status === 401) throw new Error('Your session has expired. Sign in in another tab, then retry here to keep your input.')
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw Object.assign(new Error(data.error || fallback), { status: response.status, code: data.code || null, conflict: data.conflict || null, impact: data.impact || null })
  return data
}

export function listReservableEvents() {
  return request('/api/equipment/reservable-events', {}, 'Unable to load events. Please retry.')
}

export function getEquipmentAvailability(eventId) {
  return request(`/api/equipment/availability?eventId=${encodeURIComponent(eventId)}`, {}, 'Unable to load equipment availability. Please retry.')
}

export function reserveEquipment(payload) {
  return request('/api/equipment/reservations', { method: 'POST', body: JSON.stringify(payload) }, 'Unable to save the reservation. Please retry.')
}

export function removeReservation(id) {
  return request(`/api/equipment/reservations/${encodeURIComponent(id)}`, { method: 'DELETE' }, 'Unable to remove the reservation. Please retry.')
}

// US-024: view and update inventory records.
export function listEquipment() {
  return request('/api/equipment', {}, 'Unable to load the equipment inventory. Please retry.')
}

export function getEquipment(id) {
  return request(`/api/equipment/${encodeURIComponent(id)}`, {}, 'Unable to load the equipment record. Please retry.')
}

export function updateEquipment(id, payload) {
  return request(`/api/equipment/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(payload) }, 'Unable to save your changes. Please retry.')
}
