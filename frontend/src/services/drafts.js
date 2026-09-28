import { authHeaders } from './auth'

export async function draftRequest(path = '', options = {}) {
  let response
  try {
    response = await fetch(`/api/drafts${path}`, {
    ...options,
    headers: { ...authHeaders(), 'Content-Type': 'application/json' }
    })
  } catch {
    throw new Error('Unable to reach the server. Check your connection and retry.')
  }
  if (response.status === 401) throw new Error('Your session has expired. Sign in in another tab, then retry here to keep your input.')
  let data
  try {
    data = await response.json()
    if (data === null || typeof data !== 'object') throw new Error('Invalid response')
  } catch {
    const error = new Error(response.status >= 500
      ? 'The server is temporarily unavailable. Please retry shortly.'
      : 'The server returned an unexpected response. Please retry.')
    error.status = response.status
    throw error
  }
  if (!response.ok) {
    const error = new Error(data.error || 'Request failed. Please retry.')
    error.fields = data.fields || {}
    error.status = response.status
    throw error
  }
  return data
}
