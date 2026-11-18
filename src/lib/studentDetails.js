// Foundation students' admission details — labels + admin upload helper.
// Server: server/services/studentDetailsService.js.
import { apiFetch, authHeaders } from '../api'

export const STATUS_OPTIONS = [
  { key: 'submitted',   label: 'Waiting for check', tone: 'indigo' },
  { key: 'needs_fix',   label: 'Re-upload asked',   tone: 'rose' },
  { key: 'incomplete',  label: 'Incomplete',        tone: 'amber' },
  { key: 'not_started', label: 'Not started',       tone: 'gray' },
  { key: 'approved',    label: 'Approved',          tone: 'emerald' },
]
export const STATUS_LABEL = Object.fromEntries(STATUS_OPTIONS.map(s => [s.key, s.label]))
export const TONE = {
  indigo:  'bg-indigo-50 text-indigo-700',
  rose:    'bg-rose-50 text-rose-700',
  amber:   'bg-amber-50 text-amber-800',
  gray:    'bg-gray-100 text-gray-600',
  emerald: 'bg-emerald-50 text-emerald-700',
}
export const STATUS_TONE = Object.fromEntries(STATUS_OPTIONS.map(s => [s.key, TONE[s.tone]]))

export const DOC_LABEL = { marksheet10: '10th mark sheet', schoolId: 'School ID card', photo: 'Passport photo' }
export const DOC_STATUS = {
  pending:  { label: 'Waiting', cls: TONE.amber },
  approved: { label: 'OK',      cls: TONE.emerald },
  rejected: { label: 'Re-upload', cls: TONE.rose },
}

export const phoneForInput = (p) => (p && /^91\d{10}$/.test(p) ? p.slice(2) : p || '')
export const fmtDate = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—')

// Admin uploads on the student's behalf (e.g. a parent sent it on WhatsApp).
// Goes through the server (not straight to storage) and is saved as approved.
// No progress bar — files are ≤10 MB.
export async function adminUploadDocument(studentId, type, file, { allowedTypes, maxFileBytes }) {
  if (!allowedTypes.includes(file.type)) throw new Error('Choose a JPG / PNG / WEBP photo or a PDF')
  if (file.size > maxFileBytes) throw new Error(`File is larger than ${Math.round(maxFileBytes / 1048576)} MB`)
  const form = new FormData()
  form.append('file', file)
  return apiFetch(`/api/admin/users/${studentId}/student-details/documents/${type}`, { method: 'POST', body: form, isForm: true })
}

// The current file's bytes (through the server, so a canvas can draw it).
export async function adminLoadDocument(studentId, type) {
  const headers = authHeaders()
  delete headers['Content-Type']
  const res = await fetch(`${import.meta.env.VITE_API_BASE}/api/admin/users/${studentId}/student-details/documents/${type}/file`, { headers })
  if (!res.ok) {
    let msg = 'Could not load the file'
    try { msg = (await res.json()).error || msg } catch { /* not JSON */ }
    throw new Error(msg)
  }
  return res.blob()
}

// Save a rotated / cropped photo over the document; its check status stays as it was.
export async function adminSaveEditedDocument(studentId, type, blob, key, name) {
  const form = new FormData()
  form.append('key', key)
  form.append('file', blob, name)
  return apiFetch(`/api/admin/users/${studentId}/student-details/documents/${type}/edit`, { method: 'POST', body: form, isForm: true })
}

// "marksheet.png" → "marksheet-edited.jpg"
export const editedName = (name) => `${String(name || 'photo').replace(/\.[^.]+$/, '').replace(/-edited$/, '')}-edited.jpg`
