import { useState, useEffect } from 'react'
import { apiFetch } from '../api'
import { studiesSubject, SLOT_OPTIONS } from '../lib/rosterFilter'

// Which class period suits one student, per paper — one row per paper they
// study (from their enrollment) plus an any-paper default that covers papers
// with no slot of their own. Admins change these whenever the student's
// convenience shifts; saving replaces the whole set. Papers with a slot set but
// no longer in the student's enrollment stay listed so a stale preference can
// still be cleared. Used from the Users page and the Live Classes scheduler.
//
// `subjects` is optional: the scheduler passes its already-loaded tree, the
// Users page lets the modal fetch its own.
export default function SlotEditorModal({ student, subjects: subjectsProp, onSaved, onClose }) {
  const [subjects, setSubjects] = useState(subjectsProp || null)
  useEffect(() => {
    if (subjectsProp) return
    apiFetch('/api/admin/subjects')
      .then(d => setSubjects((d.subjects || []).filter(s => s.isActive)))
      .catch(() => setSubjects([]))
  }, [subjectsProp])

  const initial = {}
  for (const p of student.slotPreferences || []) initial[String(p.subjectId || '')] = p.slot
  const [prefs, setPrefs] = useState(initial)   // subjectId ('' = default) → slot | ''
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState('')

  const scoped = (subjects || []).filter(s => studiesSubject(student, s))
  const extraIds = (student.slotPreferences || [])
    .filter(p => p.subjectId && !scoped.some(s => String(s._id) === String(p.subjectId)))
    .map(p => String(p.subjectId))
  const extras = (subjects || []).filter(s => extraIds.includes(String(s._id)))

  const rows = [
    { id: '', label: 'Any paper (default)', note: 'Used when a paper has no slot of its own' },
    ...scoped.map(s => ({ id: String(s._id), label: `${s.name} · ${s.level}` })),
    ...extras.map(s => ({ id: String(s._id), label: `${s.name} · ${s.level}`, note: 'No longer in their enrollment' })),
  ]

  const save = async () => {
    setBusy(true); setError('')
    try {
      const preferences = Object.entries(prefs)
        .filter(([, slot]) => slot)
        .map(([subjectId, slot]) => ({ subjectId: subjectId || null, slot }))
      const d = await apiFetch(`/api/admin/users/${student._id}/slot-preferences`, {
        method: 'PATCH',
        body: JSON.stringify({ preferences }),
      })
      onSaved(d.user)
    } catch (err) {
      setError(err.message || 'Could not save slot times')
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={() => !busy && onClose()}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>
        <h2 className="text-base font-bold text-gray-900">Slot times</h2>
        <p className="text-xs text-gray-400 mb-4">
          {student.name || student.phoneNumber} — which period suits them, per paper. Change any time.
        </p>

        {subjects === null ? (
          <p className="text-xs text-gray-400">Loading subjects…</p>
        ) : (
          <div className="space-y-2">
            {rows.map(r => (
              <div key={r.id} className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-gray-700 truncate">{r.label}</p>
                  {r.note && <p className="text-[10px] text-gray-400">{r.note}</p>}
                </div>
                <select value={prefs[r.id] || ''}
                  onChange={e => setPrefs(p => ({ ...p, [r.id]: e.target.value }))}
                  className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg bg-white outline-none focus:ring-2 focus:ring-indigo-400 text-gray-700">
                  <option value="">No preference</option>
                  {SLOT_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                </select>
              </div>
            ))}
            {rows.length === 1 && (
              <p className="text-[11px] text-gray-400">
                No enrollment set yet — only the default slot applies until a course is assigned.
              </p>
            )}
          </div>
        )}

        {error && <p className="text-xs text-red-500 mt-3">{error}</p>}
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} disabled={busy}
            className="px-4 py-2 rounded-xl border border-gray-200 text-gray-500 text-sm font-semibold hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={save} disabled={busy}
            className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:bg-gray-300">
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
