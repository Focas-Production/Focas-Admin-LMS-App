// Parent / guardian contact of one student — the WhatsApp number the weekly
// and monthly progress report goes to (Foundation students are school
// children). Opened from Users (Parent button) and from Parent Reports.
// Also shows what last week's report would say, so the admin can check the
// numbers before a parent ever sees them.
// Data: GET/PUT /api/admin/users/:id/parent (server/controllers/parentReportController.js).
import { useState, useEffect } from 'react'
import { apiFetch } from '../api'
import { reportMessage, showPhone } from '../lib/parentReport'

export default function ParentContactModal({ student, onClose, onSaved }) {
  const [data,   setData]   = useState(null)   // null = loading
  const [preview, setPreview] = useState(undefined)   // undefined = loading, null = none
  const [name,   setName]   = useState('')
  const [phone,  setPhone]  = useState('')
  const [off,    setOff]    = useState(false)
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  // A response that lands after this effect was torn down (React's double
  // run in development, or the pop-up reopened) is dropped, so a late load can
  // never overwrite what the admin has already typed.
  useEffect(() => {
    let alive = true
    const id = student._id || student.studentId
    // The preview is slower (it works out the week's numbers) — loaded on its
    // own so the form is usable at once.
    apiFetch(`/api/admin/users/${id}/parent?preview=1`)
      .then(d => { if (alive) setPreview(d.preview) })
      .catch(() => { if (alive) setPreview(null) })
    apiFetch(`/api/admin/users/${id}/parent`)
      .then(d => {
        if (!alive) return
        setData(d)
        setName(d.parent.name)
        setPhone(showPhone(d.parent.phone))
        setOff(d.parent.reportsOff)
      })
      .catch(e => { if (alive) { setData({ failed: true }); setError(e.message) } })
    return () => { alive = false }
  }, [student._id, student.studentId])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  async function save() {
    setSaving(true); setError('')
    try {
      const d = await apiFetch(`/api/admin/users/${student._id || student.studentId}/parent`, {
        method: 'PUT',
        body: JSON.stringify({ name, phone, reportsOff: off }),
      })
      onSaved?.(d.parent)
      onClose()
    } catch (e) {
      setError(e.message)
      setSaving(false)
    }
  }

  const loading = data === null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Parent contact"
        className="bg-white rounded-2xl w-full max-w-md max-h-[88vh] shadow-2xl overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="font-bold text-gray-900">Parent contact</h2>
            <p className="text-xs text-gray-400 mt-0.5">{student.name || student.phoneNumber || student.phone}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-gray-100 text-gray-400">✕</button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto">
          {loading ? (
            <div className="space-y-2">{[1, 2].map(i => <div key={i} className="h-10 bg-gray-100 rounded-xl animate-pulse" />)}</div>
          ) : data.failed ? null : (
            <>
              {!data.foundation && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                  Reports go to parents of <b>Foundation</b> students only. This student's level is not Foundation, so nothing is sent yet.
                </p>
              )}
              <label className="block">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Parent name <span className="normal-case font-normal text-gray-400">(optional)</span></span>
                <input value={name} onChange={e => setName(e.target.value)} maxLength={80} placeholder="e.g. Ramesh Kumar"
                  className="mt-1.5 w-full text-sm px-3 py-2 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400" />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Parent WhatsApp number</span>
                <input value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" placeholder="10-digit mobile, e.g. 98765 43210"
                  className="mt-1.5 w-full text-sm px-3 py-2 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400" />
                <span className="block text-[11px] text-gray-400 mt-1">Indian numbers get +91 added. For another country type the full number with its code. Leave empty to remove.</span>
              </label>
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input type="checkbox" checked={!off} onChange={e => setOff(!e.target.checked)} className="mt-0.5 w-4 h-4 accent-indigo-600" />
                <span className="text-sm text-gray-700">
                  Send weekly and monthly reports to this parent
                  <span className="block text-[11px] text-gray-400">Untick to stop the reports for this student only.</span>
                </span>
              </label>

              {preview === undefined && data.foundation && (
                <div className="h-24 bg-gray-50 rounded-xl animate-pulse" aria-label="Loading preview" />
              )}
              {preview && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Last week's report would say</p>
                  <pre className="text-[12px] leading-relaxed whitespace-pre-wrap font-sans bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2.5 text-gray-800">
                    {preview.stats.period.held
                      ? reportMessage('weekly', student.name, preview.periodLabel, preview.stats, data.contact)
                      : `No classes were held for this student in ${preview.periodLabel}, so no weekly report would go out.`}
                  </pre>
                </div>
              )}
            </>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="px-5 py-3 border-t flex justify-end gap-2 flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50">Cancel</button>
          <button onClick={save} disabled={saving || loading || data?.failed}
            className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 disabled:opacity-60">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
