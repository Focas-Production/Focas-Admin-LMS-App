// One Foundation student's admission details: check each document (OK /
// ask to re-upload with a reason the student sees), fix typed fields, or
// upload a document for them (saved as OK). Opened from Student Details.
import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '../api'
import {
  STATUS_LABEL, STATUS_TONE, DOC_STATUS, phoneForInput, fmtDate, adminUploadDocument,
} from '../lib/studentDetails'

const inputCls = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500'

const toForm = (d) => ({
  studentPhone: phoneForInput(d.studentPhone),
  parentName: d.parentName,
  parentPhone: phoneForInput(d.parentPhone),
  address: { ...d.address },
  school: { ...d.school, subjects: [...d.school.subjects] },
})

function DocPanel({ studentId, type, label, doc, options, onChange }) {
  const [url, setUrl] = useState(null)
  const [busy, setBusy] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState('')
  const fileRef = useRef(null)
  const base = `/api/admin/users/${studentId}/student-details/documents/${type}`

  async function show() {
    setError('')
    try { setUrl((await apiFetch(`${base}/view`)).url) } catch (e) { setError(e.message) }
  }

  async function decide(decision) {
    if (decision === 'rejected' && !reason.trim()) { setError('Write what the student should fix'); return }
    setBusy(true); setError('')
    try {
      const r = await apiFetch(`${base}/review`, { method: 'POST', body: JSON.stringify({ decision, reason: decision === 'rejected' ? reason : '', key: doc.key }) })
      setReason(''); setRejecting(false)
      onChange(r.details)
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  async function upload(e) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (doc && !window.confirm(`Replace the student's ${label}? The old file will be deleted.`)) return
    setError(''); setProgress(0)
    try { onChange((await adminUploadDocument(studentId, type, f, options)).details) }
    catch (err) { setError(err.message) }
    finally { setProgress(null) }
  }

  const isPdf = doc?.contentType === 'application/pdf'
  return (
    <div className="border border-gray-100 rounded-xl p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-gray-900">{label}</p>
        {doc ? <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${DOC_STATUS[doc.status].cls}`}>{DOC_STATUS[doc.status].label}</span>
             : <span className="text-[11px] text-gray-400">Not uploaded</span>}
      </div>
      {doc && (
        <p className="text-[11px] text-gray-400 mt-1 truncate">
          {doc.name} · {doc.uploadedBy === 'admin' ? 'uploaded by office' : 'by student'} · {fmtDate(doc.uploadedAt)}
        </p>
      )}
      {doc?.status === 'rejected' && <p className="text-xs text-rose-600 mt-1">Asked: {doc.reason}</p>}

      {doc && !url && <button onClick={show} className="mt-2 text-xs font-semibold text-indigo-600">Show file</button>}
      {url && (
        <div className="mt-2">
          {isPdf
            ? <iframe title={label} src={url} className="w-full h-72 rounded-lg border border-gray-100" />
            : <img src={url} alt={label} className="w-full max-h-72 object-contain rounded-lg bg-gray-50" />}
          <a href={url} target="_blank" rel="noreferrer" className="text-xs text-indigo-600 font-semibold">Open full size ↗</a>
        </div>
      )}

      {doc && doc.status !== 'approved' && !rejecting && (
        <div className="flex gap-2 mt-3">
          <button disabled={busy} onClick={() => decide('approved')} className="flex-1 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold disabled:opacity-60">OK</button>
          {doc.status !== 'rejected' && (
            <button disabled={busy} onClick={() => setRejecting(true)} className="flex-1 py-1.5 rounded-lg border border-rose-200 text-rose-600 text-xs font-semibold">Ask to re-upload</button>
          )}
        </div>
      )}
      {doc?.status === 'approved' && (
        <button disabled={busy} onClick={() => setRejecting(true)} className="mt-3 text-xs text-gray-500 underline">Undo OK — ask to re-upload</button>
      )}
      {rejecting && (
        <div className="mt-3 space-y-2">
          <textarea className={inputCls} rows={2} maxLength={300} autoFocus placeholder="What to fix — the student sees this (e.g. photo blurred, upload all pages)"
            value={reason} onChange={e => setReason(e.target.value)} />
          <div className="flex gap-2">
            <button onClick={() => { setRejecting(false); setReason('') }} className="flex-1 py-1.5 rounded-lg border border-gray-200 text-xs">Cancel</button>
            <button disabled={busy} onClick={() => decide('rejected')} className="flex-1 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-semibold disabled:opacity-60">Send back</button>
          </div>
        </div>
      )}

      {progress !== null
        ? <p className="text-[11px] text-gray-400 mt-2">Uploading…</p>
        : <button onClick={() => fileRef.current?.click()} className="mt-2 text-[11px] text-gray-500 underline">{doc ? 'Replace with a file I have' : 'Upload for the student'}</button>}
      <input ref={fileRef} type="file" className="hidden" accept={options.allowedTypes.join(',')} onChange={upload} />
      {error && <p className="text-xs text-rose-600 mt-2">{error}</p>}
    </div>
  )
}

export default function StudentDetailsModal({ studentId, onClose, onChanged }) {
  const [data, setData] = useState(null)       // { details, options, student }
  const [form, setForm] = useState(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    apiFetch(`/api/admin/users/${studentId}/student-details`)
      .then(r => { setData(r); setForm(toForm(r.details)) })
      .catch(e => setError(e.message))
  }, [studentId])

  const updated = (details) => { setData(d => ({ ...d, details })); onChanged?.() }

  const set = (path, v) => {
    setMsg(null)
    setForm(f => {
      const n = structuredClone(f); const parts = path.split('.'); let c = n
      for (let i = 0; i < parts.length - 1; i++) c = c[parts[i]]
      c[parts.at(-1)] = v
      return n
    })
  }

  async function save(submit) {
    setSaving(true); setMsg(null)
    try {
      const body = { ...form, school: { ...form.school, subjects: form.school.subjects } }
      const r = await apiFetch(`/api/admin/users/${studentId}/student-details`, { method: 'PUT', body: JSON.stringify({ ...body, submit: submit || !!data.details.submittedAt }) })
      setData(d => ({ ...d, details: r.details })); setForm(toForm(r.details)); onChanged?.()
      setMsg({ ok: true, text: 'Saved' })
    } catch (e) { setMsg({ ok: false, text: e.message }) } finally { setSaving(false) }
  }

  const d = data?.details
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[92vh] overflow-y-auto shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-3 flex items-center justify-between z-10">
          <div>
            <p className="text-base font-bold text-gray-900">{data?.student?.name || 'Student'} <span className="text-sm font-normal text-gray-400">{data?.student?.phone}</span></p>
            {d && <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${STATUS_TONE[d.status]}`}>{STATUS_LABEL[d.status]}</span>}
            {d?.submittedAt && <span className="text-[11px] text-gray-400 ml-2">submitted {fmtDate(d.submittedAt)}</span>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl px-2">✕</button>
        </div>

        {error && <p className="p-5 text-sm text-rose-600">{error}</p>}
        {!d && !error && <p className="p-5 text-sm text-gray-400">Loading…</p>}

        {d && form && (
          <div className="p-5 space-y-5">
            {d.locked && <p className="text-xs bg-emerald-50 text-emerald-800 rounded-lg px-3 py-2">Approved — the student can no longer change any field or document. Only the office can edit now. To let the student change something, use “Undo OK” on a document.</p>}
            {!d.required && <p className="text-xs bg-amber-50 text-amber-800 rounded-lg px-3 py-2">This student is not on Foundation, so they are not asked for these details.</p>}

            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Documents</p>
              <div className="grid md:grid-cols-3 gap-3">
                {data.options.docTypes.map(t => (
                  // keyed by the file, so a new upload starts with a fresh preview
                  <DocPanel key={`${t.key}:${d.docs[t.key]?.key || ''}`} studentId={studentId} type={t.key} label={t.label} doc={d.docs[t.key]} options={data.options} onChange={updated} />
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Details</p>
              <div className="grid sm:grid-cols-3 gap-3">
                <label className="text-xs text-gray-500">Student WhatsApp<input className={inputCls} value={form.studentPhone} onChange={e => set('studentPhone', e.target.value)} /></label>
                <label className="text-xs text-gray-500">Parent name<input className={inputCls} value={form.parentName} onChange={e => set('parentName', e.target.value)} /></label>
                <label className="text-xs text-gray-500">Parent WhatsApp<input className={inputCls} value={form.parentPhone} onChange={e => set('parentPhone', e.target.value)} /></label>
                <label className="text-xs text-gray-500 sm:col-span-3">Address<input className={inputCls} value={form.address.line} onChange={e => set('address.line', e.target.value)} /></label>
                <label className="text-xs text-gray-500">City<input className={inputCls} value={form.address.city} onChange={e => set('address.city', e.target.value)} /></label>
                <label className="text-xs text-gray-500">State<input className={inputCls} value={form.address.state} onChange={e => set('address.state', e.target.value)} /></label>
                <label className="text-xs text-gray-500">Pincode<input className={inputCls} value={form.address.pincode} onChange={e => set('address.pincode', e.target.value)} /></label>
                <label className="text-xs text-gray-500">School<input className={inputCls} value={form.school.name} onChange={e => set('school.name', e.target.value)} /></label>
                <label className="text-xs text-gray-500">School city<input className={inputCls} value={form.school.city} onChange={e => set('school.city', e.target.value)} /></label>
                <label className="text-xs text-gray-500">Board
                  <select className={inputCls} value={form.school.board} onChange={e => set('school.board', e.target.value)}>
                    <option value="">—</option>
                    {data.options.boards.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}
                  </select>
                </label>
                {form.school.board === 'OTHER' && (
                  <label className="text-xs text-gray-500">Board name<input className={inputCls} value={form.school.boardOther} onChange={e => set('school.boardOther', e.target.value)} /></label>
                )}
                <label className="text-xs text-gray-500 sm:col-span-3">Subjects taken (comma separated)
                  <input className={inputCls} value={form.school.subjects.join(', ')}
                    onChange={e => set('school.subjects', e.target.value.split(',').map(s => s.trimStart()))} />
                </label>
              </div>
              {d.missing.length > 0 && <p className="text-xs text-gray-400 mt-2">Missing: {d.missing.join(', ')}</p>}
              <div className="flex items-center gap-3 mt-3">
                <button disabled={saving} onClick={() => save(false)} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold disabled:opacity-60">{saving ? 'Saving…' : 'Save details'}</button>
                {!d.submittedAt && d.missing.length === 0 && (
                  <button disabled={saving} onClick={() => save(true)} className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-semibold">Mark as submitted</button>
                )}
                {msg && <span className={`text-sm ${msg.ok ? 'text-emerald-600' : 'text-rose-600'}`}>{msg.text}</span>}
              </div>
            </div>

            {d.history?.length > 0 && (
              <details className="text-xs text-gray-500">
                <summary className="cursor-pointer font-semibold">History ({d.history.length})</summary>
                <ul className="mt-2 space-y-1">
                  {d.history.map((h, i) => (
                    <li key={i}>
                      {fmtDate(h.at)} · {h.role === 'admin' ? `office (${h.byName || '—'})` : 'student'} · {h.action}
                      {h.doc ? ` ${data.options.docTypes.find(t => t.key === h.doc)?.label || h.doc}` : ''}{h.note ? ` — “${h.note}”` : ''}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
