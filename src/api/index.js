const BASE = import.meta.env.VITE_API_BASE

export function authHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${localStorage.getItem('admin_token')}`,
    'ngrok-skip-browser-warning': 'true',
  }
}

// isForm: sending FormData. The browser has to generate the multipart boundary itself,
// so Content-Type must be left off entirely — setting it breaks the upload.
export async function apiFetch(path, options = {}) {
  const { isForm, ...rest } = options
  const headers = authHeaders()
  if (isForm) delete headers['Content-Type']

  const res = await fetch(`${BASE}${path}`, { headers, ...rest })
  const data = await res.json()
  if (!res.ok) {
    // status/data ride along so callers can act on structured errors (e.g. PERSON_CLASH).
    const err = new Error(data.error || 'Request failed')
    err.status = res.status
    err.data = data
    throw err
  }
  return data
}

// Booking saves can come back with code PERSON_CLASH: someone (the host or a
// listed student) is already booked elsewhere at that time. That is a warning,
// not a refusal — show it and, if the scheduler still wants it, re-send with
// allowClash. `send(extra)` must merge `extra` into its JSON body.
export async function saveWithClashCheck(send) {
  try {
    return await send({})
  } catch (err) {
    if (err.data?.code !== 'PERSON_CLASH') throw err
    if (!window.confirm(`${err.message}\n\nSave anyway?`)) {
      const e = new Error('Not saved — change the time or the people, or save anyway.')
      e.cancelled = true
      throw e
    }
    return send({ allowClash: true })
  }
}
