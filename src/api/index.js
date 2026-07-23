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
  if (!res.ok) throw new Error(data.error || 'Request failed')
  return data
}
