import { useState, useEffect, useMemo } from 'react'
import { apiFetch } from '../../api'

const LEVELS = ['Foundation', 'Intermediate', 'Final']

const SECTION_TABS = [
  ['notifications', 'WhatsApp Notifications'],
  ['mentors',      'Mentor Assignments'],
  ['submissions',  'Submissions'],
]

export default function TestSeriesAdminPage() {
  const [toast, setToast] = useState('')
  const [section, setSection] = useState('notifications')
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 3500) }

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-gray-900 text-white text-sm px-4 py-2.5 rounded-xl shadow-lg">{toast}</div>
      )}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Test Series</h1>
        <p className="text-gray-400 text-sm mt-1">Configure WhatsApp notifications and assign mentors to subjects.</p>
      </div>

      {/* Section tabs */}
      <div className="flex gap-2 mb-6 border-b border-gray-200">
        {SECTION_TABS.map(([v, l]) => (
          <button key={v} onClick={() => setSection(v)}
            className={`px-4 py-2.5 text-sm font-semibold -mb-px border-b-2 transition-colors ${
              section === v ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}>{l}</button>
        ))}
      </div>

      {section === 'notifications' && <NotifySettings showToast={showToast} />}
      {section === 'mentors'      && <MentorAssignments showToast={showToast} />}
      {section === 'submissions'  && <SubmissionsView showToast={showToast} />}
    </div>
  )
}

// ───────────────────────── submissions (read-only + manual assign) ─────────────────────────
const STATUS_TABS = [['', 'All'], ['pending', 'Pending'], ['assigned', 'Assigned'], ['completed', 'Completed']]
const STATUS_STYLE = {
  pending:   'bg-amber-100 text-amber-700',
  assigned:  'bg-blue-100 text-blue-700',
  completed: 'bg-emerald-100 text-emerald-700',
}

function SubmissionsView({ showToast }) {
  const [status, setStatus] = useState('')
  const [rows, setRows] = useState(null)
  const [mentors, setMentors] = useState([])
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(20)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [detailId, setDetailId] = useState(null)   // submission opened in the detail modal

  const load = (st = status, pg = page, lim = limit) => {
    setRows(null)
    const params = new URLSearchParams({ page: pg, limit: lim })
    if (st) params.set('status', st)
    apiFetch(`/api/admin/test-submissions?${params.toString()}`)
      .then(d => {
        setRows(d.submissions || [])
        setTotal(d.total || 0)
        setTotalPages(d.totalPages || 1)
      })
      .catch(() => { setRows([]); setTotal(0); setTotalPages(1) })
  }
  useEffect(() => { load(status, page, limit) }, [status, page, limit])
  useEffect(() => { apiFetch('/api/admin/mentors').then(d => setMentors(d.mentors || [])).catch(() => {}) }, [])

  // Reset to page 1 when the filter or page size changes
  const onStatus = (v) => { setStatus(v); setPage(1) }
  const onLimit  = (v) => { setLimit(v); setPage(1) }

  const assign = async (id, mentorId) => {
    if (!mentorId) return
    try {
      await apiFetch(`/api/admin/test-submissions/${id}/assign`, {
        method: 'PUT', body: JSON.stringify({ mentorId }),
      })
      showToast('Assigned to mentor')
      load(status, page, limit)
    } catch (e) { showToast(e.message) }
  }

  const rangeStart = total === 0 ? 0 : (page - 1) * limit + 1
  const rangeEnd   = Math.min(page * limit, total)

  return (
    <section className="bg-white rounded-2xl shadow-sm p-5">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="font-bold text-gray-900">Submissions</h2>
        <div className="flex gap-1.5">
          {STATUS_TABS.map(([v, l]) => (
            <button key={v} onClick={() => onStatus(v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                status === v ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}>{l}</button>
          ))}
        </div>
      </div>
      <p className="text-xs text-gray-400 mb-4">Read-only overview. Assign a pending paper to a mentor manually, or let it sit in the pool for self-claim.</p>

      {rows === null ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : !rows.length ? (
        <p className="text-sm text-gray-500">No submissions{status ? ` with status "${status}"` : ''} yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <th className="text-left font-semibold px-3 py-2.5">Student</th>
                <th className="text-left font-semibold px-3 py-2.5">Level</th>
                <th className="text-left font-semibold px-3 py-2.5">Subject</th>
                <th className="text-left font-semibold px-3 py-2.5">Chapter</th>
                <th className="text-left font-semibold px-3 py-2.5">Paper</th>
                <th className="text-center font-semibold px-3 py-2.5">Marks</th>
                <th className="text-left font-semibold px-3 py-2.5">Mentor</th>
                <th className="text-center font-semibold px-3 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r._id} onClick={() => setDetailId(r._id)}
                  className="border-t border-gray-50 cursor-pointer hover:bg-gray-50">
                  <td className="px-3 py-2.5">
                    <p className="text-gray-800 font-medium">{r.studentName || '—'}</p>
                    <p className="text-xs text-gray-400">{r.studentPhone}</p>
                  </td>
                  <td className="px-3 py-2.5 text-gray-600">{r.level || '—'}</td>
                  <td className="px-3 py-2.5 text-gray-600">{r.subject}</td>
                  <td className="px-3 py-2.5 text-gray-600">
                    {r.chapter || '—'}
                    {r.unit && <span className="block text-[11px] text-indigo-500">{r.unit}</span>}
                  </td>
                  <td className="px-3 py-2.5 text-gray-600">{r.fileName}</td>
                  <td className="px-3 py-2.5 text-center text-gray-600">
                    {r.status === 'completed' && r.awardedMarks != null
                      ? <span className="font-semibold text-emerald-700">{r.awardedMarks}/{r.totalMarks}</span>
                      : r.totalMarks}
                  </td>
                  <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                    {r.status === 'completed' ? (
                      <span className="text-gray-600">{r.mentor?.name || '—'}</span>
                    ) : (
                      <select defaultValue={r.mentor?._id || ''} onChange={e => assign(r._id, e.target.value)}
                        className="px-2 py-1 text-xs border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400">
                        <option value="">{r.mentor ? r.mentor.name : 'Pool — assign…'}</option>
                        {mentors.map(m => <option key={m._id} value={m._id}>{m.name || m.phoneNumber}</option>)}
                      </select>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_STYLE[r.status] || ''}`}>
                      {r.status}{r.assignedVia ? ` · ${r.assignedVia}` : ''}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination footer */}
      {rows !== null && total > 0 && (
        <div className="flex items-center justify-between flex-wrap gap-3 mt-4 pt-4 border-t border-gray-100">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span>Rows per page:</span>
            <select value={limit} onChange={e => onLimit(Number(e.target.value))}
              className="px-2 py-1 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400">
              {[10, 20, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <span className="ml-1">{rangeStart}–{rangeEnd} of {total}</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">
              ← Previous
            </button>
            <span className="text-xs text-gray-500">Page {page} of {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">
              Next →
            </button>
          </div>
        </div>
      )}

      {detailId && <SubmissionDetailModal id={detailId} onClose={() => setDetailId(null)} />}
    </section>
  )
}

// ───────────────────────── submission detail (full drill-down) ─────────────────────────
function fmtDate(d) {
  if (!d) return '—'
  const dt = new Date(d)
  return Number.isNaN(dt.getTime()) ? '—' : dt.toLocaleString()
}

// Open a file/document in a new tab. The blank window is opened synchronously (before
// the await) so browsers don't treat it as a popup and block it.
async function openInTab(path, onError) {
  const win = window.open('', '_blank')
  try {
    const { url } = await apiFetch(path)
    if (win) win.location = url
    else window.location.href = url
  } catch (e) {
    if (win) win.close()
    onError?.(e.message || 'Unable to open document')
  }
}

function InfoRow({ label, children }) {
  return (
    <div className="flex gap-2 text-sm py-1">
      <span className="w-32 flex-shrink-0 text-gray-400">{label}</span>
      <span className="text-gray-800 font-medium break-words">{children}</span>
    </div>
  )
}

function DocBtn({ children, onClick, disabled, color = 'indigo' }) {
  const styles = {
    indigo:  'bg-indigo-50 text-indigo-700 hover:bg-indigo-100',
    emerald: 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
    amber:   'bg-amber-50 text-amber-700 hover:bg-amber-100',
    rose:    'bg-rose-50 text-rose-700 hover:bg-rose-100',
  }
  return (
    <button onClick={onClick} disabled={disabled}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50 ${styles[color]}`}>
      {children}
    </button>
  )
}

function SubmissionDetailModal({ id, onClose }) {
  const [sub, setSub] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setSub(null); setError('')
    apiFetch(`/api/admin/test-submissions/${id}`)
      .then(d => setSub(d.submission))
      .catch(e => setError(e.message || 'Failed to load submission'))
  }, [id])

  const base = `/api/admin/test-submissions/${id}`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white">
          <h2 className="font-bold text-gray-900">Test Submission Details</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-lg leading-none">✕</button>
        </div>

        {error ? (
          <div className="p-6 text-sm text-red-600">{error}</div>
        ) : !sub ? (
          <div className="p-6 text-sm text-gray-400">Loading…</div>
        ) : (
          <div className="p-5 space-y-5">
            {/* Student */}
            <div className="bg-gray-50 rounded-xl px-4 py-3">
              <p className="text-xs text-gray-400 mb-1">Student</p>
              <p className="text-gray-900 font-semibold">{sub.studentName || '—'}</p>
              <p className="text-sm text-gray-500">{sub.studentPhone || '—'}</p>
            </div>

            {/* Test info */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Test</p>
              <InfoRow label="Test type">{sub.testSeriesType || '—'}</InfoRow>
              <InfoRow label="Level">{sub.level || '—'}</InfoRow>
              <InfoRow label="Subject">{sub.subject || '—'}</InfoRow>
              <InfoRow label="Chapter">{sub.chapter || '—'}</InfoRow>
              {sub.unit && <InfoRow label="Unit / Part">{sub.unit}</InfoRow>}
              <InfoRow label="Paper">{sub.fileName || '—'}</InfoRow>
              <InfoRow label="Duration">{sub.testDuration ? `${sub.testDuration} min` : '—'}</InfoRow>
              <InfoRow label="Total marks">{sub.totalMarks ?? '—'}</InfoRow>
              <InfoRow label="Status">
                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_STYLE[sub.status] || ''}`}>
                  {sub.status}{sub.assignedVia ? ` · ${sub.assignedVia}` : ''}
                </span>
              </InfoRow>
              <InfoRow label="Started at">{fmtDate(sub.startedAt)}</InfoRow>
              <InfoRow label="Submitted at">{fmtDate(sub.submittedAt || sub.createdAt)}</InfoRow>
            </div>

            {/* Documents */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Documents</p>
              <div className="flex flex-wrap gap-2">
                <DocBtn disabled={!sub.hasQuestionPaper} onClick={() => openInTab(`${base}/question-paper`, setError)}>
                  📄 Question Paper
                </DocBtn>
                <DocBtn color="emerald" disabled={!sub.hasAnswerKey} onClick={() => openInTab(`${base}/answer-key`, setError)}>
                  ✅ Answer Key
                </DocBtn>
              </div>
              {!sub.hasQuestionPaper && !sub.hasAnswerKey && (
                <p className="text-xs text-gray-400 mt-2">No question paper / answer key attached to this test.</p>
              )}
            </div>

            {/* Student's uploaded answer sheet(s) */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Student's Answer Sheet</p>
              {(sub.answerFiles || []).length === 0 ? (
                <p className="text-xs text-gray-400">No files uploaded.</p>
              ) : (
                <div className="space-y-2">
                  {sub.answerFiles.map(f => (
                    <div key={f.key} className="flex items-center justify-between gap-2 bg-gray-50 rounded-lg px-3 py-2">
                      <span className="text-sm text-gray-700 truncate" title={f.name}>{f.name}</span>
                      <div className="flex gap-2 flex-shrink-0">
                        <DocBtn onClick={() => openInTab(`${base}/file?key=${encodeURIComponent(f.key)}&inline=1`, setError)}>View</DocBtn>
                        <DocBtn color="amber" onClick={() => openInTab(`${base}/file?key=${encodeURIComponent(f.key)}`, setError)}>Download</DocBtn>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Evaluation */}
            {sub.status === 'completed' ? (
              <div className="border-t border-gray-100 pt-4">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Evaluation</p>
                <InfoRow label="Mentor">{sub.mentor?.name || '—'}{sub.mentor?.phoneNumber ? ` · ${sub.mentor.phoneNumber}` : ''}</InfoRow>
                <InfoRow label="Marks awarded">
                  <span className="font-semibold text-emerald-700">{sub.awardedMarks ?? '—'}/{sub.totalMarks}</span>
                </InfoRow>
                <InfoRow label="Evaluated at">{fmtDate(sub.evaluatedAt)}</InfoRow>
                {sub.mentorNotes && (
                  <div className="mt-2">
                    <p className="text-xs text-gray-400 mb-1">Mentor notes</p>
                    <p className="text-sm text-gray-700 bg-gray-50 rounded-lg px-3 py-2 whitespace-pre-wrap">{sub.mentorNotes}</p>
                  </div>
                )}

                {/* Corrected / evaluated sheet(s) */}
                <div className="mt-3">
                  <p className="text-xs text-gray-400 mb-1.5">Evaluated Sheet</p>
                  {(sub.evaluatedFiles || []).length === 0 ? (
                    <p className="text-xs text-gray-400">No corrected sheet uploaded.</p>
                  ) : (
                    <div className="space-y-2">
                      {sub.evaluatedFiles.map(f => (
                        <div key={f.key} className="flex items-center justify-between gap-2 bg-gray-50 rounded-lg px-3 py-2">
                          <span className="text-sm text-gray-700 truncate" title={f.name}>{f.name}</span>
                          <div className="flex gap-2 flex-shrink-0">
                            <DocBtn color="emerald" onClick={() => openInTab(`${base}/file?key=${encodeURIComponent(f.key)}&inline=1`, setError)}>View</DocBtn>
                            <DocBtn color="amber" onClick={() => openInTab(`${base}/file?key=${encodeURIComponent(f.key)}`, setError)}>Download</DocBtn>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Drive / review link */}
                {sub.reviewVideoUrl && (
                  <div className="mt-3">
                    <p className="text-xs text-gray-400 mb-1.5">Drive Link / Review Video</p>
                    <a href={sub.reviewVideoUrl} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-50 text-rose-700 hover:bg-rose-100">
                      🔗 Open Link ↗
                    </a>
                  </div>
                )}
              </div>
            ) : (
              <div className="border-t border-gray-100 pt-4">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Evaluation</p>
                <p className="text-sm text-gray-500">
                  Not evaluated yet{sub.mentor?.name ? ` — assigned to ${sub.mentor.name}` : ' — sitting in the mentor pool'}.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ───────────────────────── WhatsApp notification settings ─────────────────────────
function NotifySettings({ showToast }) {
  const [recipients, setRecipients] = useState([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    apiFetch('/api/admin/settings').then(s => {
      setRecipients(s.testNotifyRecipients?.length ? s.testNotifyRecipients : [])
    }).catch(() => {})
  }, [])

  const addRow = () => setRecipients(r => [...r, { name: '', phone: '' }])
  const setRow = (i, key, val) => setRecipients(r => r.map((x, j) => j === i ? { ...x, [key]: val } : x))
  const removeRow = (i) => setRecipients(r => r.filter((_, j) => j !== i))

  const save = async () => {
    setSaving(true)
    try {
      await apiFetch('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({
          testNotifyRecipients: recipients.filter(r => r.phone.trim()),
        }),
      })
      showToast('Recipients saved')
    } catch (e) { showToast(e.message) } finally { setSaving(false) }
  }

  return (
    <section className="bg-white rounded-2xl shadow-sm p-5 mb-6">
      <h2 className="font-bold text-gray-900 mb-1">WhatsApp Notifications</h2>
      <p className="text-xs text-gray-400 mb-4">Template names are configured in <code className="bg-gray-100 px-1 rounded">server/.env</code>. Add the staff who should be alerted when a student submits a test.</p>

      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-semibold text-gray-600">Staff recipients (notified when a student submits)</label>
          <button onClick={addRow} className="text-xs font-semibold text-indigo-600 hover:text-indigo-700">+ Add member</button>
        </div>
        {recipients.length === 0 && <p className="text-xs text-gray-400">No recipients yet — add one above.</p>}
        <div className="space-y-2">
          {recipients.map((r, i) => (
            <div key={i} className="flex gap-2">
              <input value={r.name} onChange={e => setRow(i, 'name', e.target.value)} placeholder="Name"
                className="w-1/3 px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400" />
              <input value={r.phone} onChange={e => setRow(i, 'phone', e.target.value)} placeholder="Phone e.g. 919876543210"
                className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400" />
              <button onClick={() => removeRow(i)} className="px-2 text-gray-400 hover:text-red-500">✕</button>
            </div>
          ))}
        </div>
      </div>

      <button onClick={save} disabled={saving}
        className="px-5 py-2.5 rounded-xl bg-indigo-600 text-white font-semibold text-sm hover:bg-indigo-700 disabled:bg-gray-300">
        {saving ? 'Saving…' : 'Save Notifications'}
      </button>
    </section>
  )
}

// ───────────────────────── mentor → subject assignments ─────────────────────────
function MentorAssignments({ showToast }) {
  const [mentors, setMentors] = useState([])
  const [subjects, setSubjects] = useState([])
  const [loading, setLoading] = useState(true)

  const load = () => {
    Promise.all([
      apiFetch('/api/admin/mentors').then(d => d.mentors || []),
      apiFetch('/api/admin/subjects').then(d => d.subjects || []),
    ]).then(([m, s]) => { setMentors(m); setSubjects(s) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const subjectName = (id) => subjects.find(s => String(s._id) === String(id))?.name || 'Unknown'

  const saveMentor = async (mentorId, assignments) => {
    try {
      await apiFetch(`/api/admin/mentors/${mentorId}/assignments`, {
        method: 'PUT',
        body: JSON.stringify({ assignments }),
      })
      setMentors(ms => ms.map(m => m._id === mentorId ? { ...m, mentorAssignments: assignments } : m))
      showToast('Assignments saved')
    } catch (e) { showToast(e.message) }
  }

  // Even split: round-robin every subject (all levels) across all mentors.
  const evenSplit = async () => {
    if (!mentors.length) return showToast('No mentors found. Run createMentor.js first.')
    if (!window.confirm('Replace ALL mentor assignments with an even round-robin split of every subject?')) return
    const buckets = mentors.map(() => [])
    subjects.forEach((s, i) => { buckets[i % mentors.length].push({ level: s.level, subjectId: s._id }) })
    try {
      await Promise.all(mentors.map((m, i) =>
        apiFetch(`/api/admin/mentors/${m._id}/assignments`, { method: 'PUT', body: JSON.stringify({ assignments: buckets[i] }) })
      ))
      load()
      showToast('Subjects split evenly across mentors')
    } catch (e) { showToast(e.message) }
  }

  return (
    <section className="bg-white rounded-2xl shadow-sm p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="font-bold text-gray-900">Mentor Assignments</h2>
        {mentors.length > 1 && (
          <button onClick={evenSplit} className="text-xs font-semibold text-indigo-600 hover:text-indigo-700">⚖ Even split</button>
        )}
      </div>
      <p className="text-xs text-gray-400 mb-4">A submission auto-routes to a mentor assigned to its level + subject (balanced by load). Mentors can also self-claim from the pool.</p>

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : !mentors.length ? (
        <p className="text-sm text-gray-500">No mentors yet. Create them with <code className="bg-gray-100 px-1 rounded">node scripts/createMentor.js</code>.</p>
      ) : (
        <div className="space-y-3">
          {mentors.map(m => (
            <MentorRow key={m._id} mentor={m} subjects={subjects} subjectName={subjectName}
              onSave={(assignments) => saveMentor(m._id, assignments)} />
          ))}
        </div>
      )}
    </section>
  )
}

function MentorRow({ mentor, subjects, subjectName, onSave }) {
  const [assignments, setAssignments] = useState(mentor.mentorAssignments || [])
  const [level, setLevel] = useState('')
  const [subjectId, setSubjectId] = useState('')

  const dirty = useMemo(
    () => JSON.stringify(assignments) !== JSON.stringify(mentor.mentorAssignments || []),
    [assignments, mentor.mentorAssignments]
  )
  const subjectsForLevel = subjects.filter(s => s.level === level)

  const add = () => {
    if (!level || !subjectId) return
    if (assignments.some(a => a.level === level && String(a.subjectId) === String(subjectId))) return
    setAssignments(a => [...a, { level, subjectId }])
    setSubjectId('')
  }
  const remove = (i) => setAssignments(a => a.filter((_, j) => j !== i))

  return (
    <div className="border border-gray-100 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="font-semibold text-gray-900 text-sm">{mentor.name || 'Mentor'}</p>
          <p className="text-xs text-gray-400">{mentor.phoneNumber}</p>
        </div>
        {dirty && (
          <button onClick={() => onSave(assignments)}
            className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700">Save</button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 mb-3">
        {assignments.length === 0 && <span className="text-xs text-gray-400">No subjects assigned</span>}
        {assignments.map((a, i) => (
          <span key={i} className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 text-xs font-medium px-2 py-1 rounded-lg">
            {a.level} · {subjectName(a.subjectId)}
            <button onClick={() => remove(i)} className="text-indigo-400 hover:text-red-500">✕</button>
          </span>
        ))}
      </div>

      <div className="flex gap-2">
        <select value={level} onChange={e => { setLevel(e.target.value); setSubjectId('') }}
          className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400">
          <option value="">Level…</option>
          {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
        <select value={subjectId} onChange={e => setSubjectId(e.target.value)} disabled={!level}
          className="flex-1 px-2 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400 disabled:bg-gray-50">
          <option value="">Subject…</option>
          {subjectsForLevel.map(s => <option key={s._id} value={s._id}>{s.name}</option>)}
        </select>
        <button onClick={add} disabled={!level || !subjectId}
          className="px-3 py-1.5 rounded-lg bg-gray-900 text-white text-xs font-semibold disabled:bg-gray-200 disabled:text-gray-400">Add</button>
      </div>
    </div>
  )
}
