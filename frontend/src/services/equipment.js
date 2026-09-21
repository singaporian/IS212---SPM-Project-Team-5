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
