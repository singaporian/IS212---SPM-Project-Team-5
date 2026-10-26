import { authHeaders } from './auth'

export async function bookingNotesRequest(bookingId, { method = 'GET', noteId, noteText } = {}) {
  const response = await fetch(`/api/bookings/${encodeURIComponent(bookingId)}/notes${noteId ? '/' + encodeURIComponent(noteId) : ''}`, {
    method,
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    ...(method === 'POST' || method === 'PATCH' ? { body: JSON.stringify({ noteText }) } : {})
  })
  if (response.status === 204 && response.ok) return null
  let data
  try { data = await response.json() } catch { throw new Error('Unable to contact the server. Please retry.') }
  if (!response.ok) throw new Error(data.error || 'Unable to save internal notes. Please retry.')
  return data
}
