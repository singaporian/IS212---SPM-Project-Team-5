import { authHeaders } from './auth'

export async function draftRequest(path = '', options = {}) {
  const response = await fetch(`/api/drafts${path}`, {
    ...options,
    headers: { ...authHeaders(), 'Content-Type': 'application/json' }
  })
  if (response.status === 401) throw new Error('Your session has expired. Sign in in another tab, then retry here to keep your input.')
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Request failed. Please retry.')
  return data
}
