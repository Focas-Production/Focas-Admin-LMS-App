import { useState, useEffect, useMemo, useCallback } from 'react'
import { apiFetch } from '../../api'
import MarkdownBlock from '../../components/MarkdownBlock'

// Admin: turn question_bank PDFs into structured AI-ready questions.
// Flow per bank:  Test Extract (sample, saves nothing)  →  Extract All (saves drafts)
//                 →  review drafts  →  Publish (students can then generate from them)

const STATUS_STYLE = {
  draft:     'bg-amber-100 text-amber-700',
  published: 'bg-emerald-100 text-emerald-700',
  archived:  'bg-gray-100 text-gray-500',
}
const TYPE_STYLE = {
  Numerical: 'bg-indigo-50 text-indigo-700',
  Theory:    'bg-sky-50 text-sky-700',
  MCQ:       'bg-purple-50 text-purple-700',
  CaseStudy: 'bg-rose-50 text-rose-700',
}

export default function AiQuestionBankPage() {
  const [banks, setBanks]       = useState([])
  const [loading, setLoading]   = useState(true)
  const [selected, setSelected] = useState(null)   // the chosen question_bank content
  const [toast, setToast]       = useState('')
  const [search, setSearch]     = useState('')

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 4000) }

  useEffect(() => {
    apiFetch('/api/admin/content?category=question_bank&limit=500')
      .then(d => setBanks(d.content || []))
      .catch(() => setBanks([]))
      .finally(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return banks
    return banks.filter(b =>
      [b.title, b.subject, b.folder].filter(Boolean).some(v => v.toLowerCase().includes(q))
    )
  }, [banks, search])

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto">
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-gray-900 text-white text-sm px-4 py-2.5 rounded-xl shadow-lg">{toast}</div>
      )}

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">AI Question Bank</h1>
        <p className="text-gray-400 text-sm mt-1">
          Extract questions from your question-bank PDFs so students can generate similar practice questions.
          Always run a <strong>Test Extract</strong> first, then review the drafts before publishing.
        </p>
      </div>

      {selected ? (
        <BankDetail bank={selected} onBack={() => setSelected(null)} showToast={showToast} />
      ) : (
        <>
        <LimitsPanel showToast={showToast} />
        <section className="bg-white rounded-2xl shadow-sm p-5">
          <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
            <h2 className="font-bold text-gray-900">Question Bank PDFs</h2>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search subject / chapter…"
              className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400 w-64" />
          </div>

          {loading ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : !filtered.length ? (
            <p className="text-sm text-gray-500">No question-bank PDFs found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs">
                  <tr>
                    <th className="text-left font-semibold px-3 py-2.5">Subject</th>
                    <th className="text-left font-semibold px-3 py-2.5">Chapter</th>
                    <th className="text-left font-semibold px-3 py-2.5">File</th>
                    <th className="text-left font-semibold px-3 py-2.5">Level</th>
                    <th className="px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(b => (
                    <tr key={b._id} className="border-t border-gray-50 hover:bg-gray-50">
                      <td className="px-3 py-2.5 text-gray-800 font-medium">{b.subject || '—'}</td>
                      <td className="px-3 py-2.5 text-gray-600">{b.folder || '—'}</td>
                      <td className="px-3 py-2.5 text-gray-500 truncate max-w-[220px]" title={b.title}>{b.title}</td>
                      <td className="px-3 py-2.5 text-gray-500">{b.level || '—'}</td>
                      <td className="px-3 py-2.5 text-right">
                        <button onClick={() => setSelected(b)}
                          className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700">
                          Open
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        </>
      )}
    </div>
  )
}

// ── Admin-configurable monthly generation limits (Lite / Pro) ──
function LimitsPanel({ showToast }) {
  const [lite, setLite]     = useState('')
  const [pro, setPro]       = useState('')
  const [orig, setOrig]     = useState({ lite: '', pro: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    apiFetch('/api/admin/settings').then(s => {
      const l = String(s?.aiGen?.liteMonthlyLimit ?? 10)
      const p = String(s?.aiGen?.proMonthlyLimit ?? 50)
      setLite(l); setPro(p); setOrig({ lite: l, pro: p })
    }).catch(() => {})
  }, [])

  const dirty = lite !== orig.lite || pro !== orig.pro

  const save = async () => {
    setSaving(true)
    try {
      await apiFetch('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({ aiGen: { liteMonthlyLimit: Number(lite), proMonthlyLimit: Number(pro) } }),
      })
      setOrig({ lite, pro })
      showToast('AI generation limits saved')
    } catch (e) { showToast(e.message) } finally { setSaving(false) }
  }

  const inp = 'w-28 px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400'
  return (
    <section className="bg-white rounded-2xl shadow-sm p-5 mb-6">
      <h2 className="font-bold text-gray-900 mb-1">Monthly Generation Limits</h2>
      <p className="text-xs text-gray-400 mb-4">
        How many AI questions a student may generate per calendar month. A student is <strong>Pro</strong> if they own
        any product marked AI&nbsp;Pro, otherwise <strong>Lite</strong>. Usage resets automatically each month.
        Set 0 to disable a tier. Individual students can be given a higher limit on the Users page.
      </p>
      <div className="flex flex-wrap items-end gap-5">
        <label className="block">
          <span className="block text-xs font-semibold text-sky-700 mb-1">Lite — per month</span>
          <input type="number" min="0" value={lite} onChange={e => setLite(e.target.value)} className={inp} />
        </label>
        <label className="block">
          <span className="block text-xs font-semibold text-violet-700 mb-1">Pro — per month</span>
          <input type="number" min="0" value={pro} onChange={e => setPro(e.target.value)} className={inp} />
        </label>
        <button onClick={save} disabled={!dirty || saving}
          className="px-5 py-2 rounded-xl bg-indigo-600 text-white font-semibold text-sm hover:bg-indigo-700 disabled:bg-gray-200 disabled:text-gray-400">
          {saving ? 'Saving…' : 'Save Limits'}
        </button>
      </div>
    </section>
  )
}

// ───────────────────────── one bank: extract + review ─────────────────────────
function BankDetail({ bank, onBack, showToast }) {
  const [testing, setTesting]   = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [preview, setPreview]   = useState(null)   // result of a Test Extract (unsaved)
  const [error, setError]       = useState('')

  const [rows, setRows]     = useState(null)
  const [counts, setCounts] = useState({})
  const [status, setStatus] = useState('')
  const [page, setPage]     = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal]   = useState(0)
  const [busyId, setBusyId] = useState(null)
  const [publishing, setPublishing] = useState(false)

  const load = useCallback(async () => {
    setRows(null)
    try {
      const params = new URLSearchParams({ contentId: bank._id, page, limit: '10' })
      if (status) params.set('status', status)
      const d = await apiFetch(`/api/admin/question-bank?${params}`)
      setRows(d.questions || []); setCounts(d.counts || {}); setTotal(d.total || 0); setTotalPages(d.totalPages || 1)
    } catch { setRows([]) }
  }, [bank._id, status, page])

  useEffect(() => { load() }, [load])

  const runTest = async () => {
    setTesting(true); setError(''); setPreview(null)
    try {
      const d = await apiFetch(`/api/admin/question-bank/${bank._id}/extract-test`, { method: 'POST' })
      setPreview(d)
    } catch (e) { setError(e.message || 'Test extraction failed') }
    finally { setTesting(false) }
  }

  const runFull = async () => {
    const replace = counts.draft || counts.published
      ? window.confirm('This bank already has extracted questions.\n\nOK = delete existing and re-extract\nCancel = keep them and add new ones')
      : false
    if (!window.confirm('Run FULL extraction on this PDF? This calls the AI for every page and costs money (one-time).')) return
    setExtracting(true); setError('')
    try {
      const d = await apiFetch(`/api/admin/question-bank/${bank._id}/extract`, {
        method: 'POST', body: JSON.stringify({ replace }),
      })
      showToast(`Extracted ${d.saved} question(s) as drafts · ₹${d.cost?.inr ?? '—'}`)
      setPreview(null); setPage(1); load()
    } catch (e) { setError(e.message || 'Extraction failed') }
    finally { setExtracting(false) }
  }

  const setOne = async (id, patch) => {
    setBusyId(id)
    try { await apiFetch(`/api/admin/question-bank/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }); load() }
    catch (e) { showToast(e.message) }
    finally { setBusyId(null) }
  }

  const removeOne = async (id) => {
    if (!window.confirm('Delete this extracted question?')) return
    setBusyId(id)
    try { await apiFetch(`/api/admin/question-bank/${id}`, { method: 'DELETE' }); load() }
    catch (e) { showToast(e.message) }
    finally { setBusyId(null) }
  }

  const publishAll = async () => {
    if (!window.confirm(`Publish ALL drafts in this bank? Students will be able to generate from them.`)) return
    setPublishing(true)
    try {
      const d = await apiFetch('/api/admin/question-bank/publish', {
        method: 'POST', body: JSON.stringify({ contentId: bank._id, status: 'published' }),
      })
      showToast(`Published ${d.updated} question(s)`); load()
    } catch (e) { showToast(e.message) }
    finally { setPublishing(false) }
  }

  return (
    <div className="space-y-5">
      <button onClick={onBack} className="text-sm text-indigo-600 font-semibold hover:text-indigo-700">← All question banks</button>

      <section className="bg-white rounded-2xl shadow-sm p-5">
        <h2 className="font-bold text-gray-900">{bank.subject} · {bank.folder}</h2>
        <p className="text-xs text-gray-400 mt-0.5">{bank.title} · {bank.level || '—'}</p>

        <div className="flex flex-wrap items-center gap-2 mt-4">
          <button onClick={runTest} disabled={testing || extracting}
            className="px-4 py-2 rounded-xl bg-amber-100 text-amber-800 text-sm font-semibold hover:bg-amber-200 disabled:opacity-50">
            {testing ? 'Testing…' : '🧪 Test Extract (sample)'}
          </button>
          <button onClick={runFull} disabled={testing || extracting}
            className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">
            {extracting ? 'Extracting… (may take minutes)' : 'Extract All → drafts'}
          </button>
          {(counts.draft > 0) && (
            <button onClick={publishAll} disabled={publishing}
              className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50">
              {publishing ? 'Publishing…' : `Publish all ${counts.draft} draft(s)`}
            </button>
          )}
          <span className="text-xs text-gray-400 ml-auto">
            drafts {counts.draft || 0} · published {counts.published || 0}
          </span>
        </div>
        <p className="text-[11px] text-gray-400 mt-2">
          Test Extract samples only the first couple of pages/chunks and saves nothing — use it to judge quality before paying for a full run.
        </p>
        {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
      </section>

      {preview && <PreviewPanel preview={preview} onClose={() => setPreview(null)} />}

      <section className="bg-white rounded-2xl shadow-sm p-5">
        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <h3 className="font-bold text-gray-900">Extracted Questions {total ? `(${total})` : ''}</h3>
          <select value={status} onChange={e => { setStatus(e.target.value); setPage(1) }}
            className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400">
            <option value="">All statuses</option>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="archived">Archived</option>
          </select>
        </div>

        {rows === null ? <p className="text-sm text-gray-400">Loading…</p>
          : !rows.length ? <p className="text-sm text-gray-500">Nothing extracted yet. Run <strong>Test Extract</strong>, then <strong>Extract All</strong>.</p>
          : (
            <div className="space-y-3">
              {rows.map(q => (
                <QuestionCard key={q._id} q={q} busy={busyId === q._id}
                  onStatus={(s) => setOne(q._id, { status: s })} onDelete={() => removeOne(q._id)} />
              ))}
              {totalPages > 1 && (
                <div className="flex items-center justify-between pt-2">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 text-gray-600 disabled:opacity-40">← Prev</button>
                  <span className="text-xs text-gray-500">Page {page} of {totalPages}</span>
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 text-gray-600 disabled:opacity-40">Next →</button>
                </div>
              )}
            </div>
          )}
      </section>
    </div>
  )
}

// Unsaved sample result from a Test Extract
function PreviewPanel({ preview, onClose }) {
  const withVars = preview.questions.filter(q => (q.variables || []).length).length
  return (
    <section className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="font-bold text-amber-900">🧪 Test Extract — preview only (nothing saved)</h3>
          <p className="text-xs text-amber-700 mt-1">
            {preview.mode === 'vision-ocr' ? 'Scanned PDF → vision OCR' : 'Digital PDF → text'} ·
            sampled {preview.processed}/{preview.total} {preview.mode === 'vision-ocr' ? 'pages' : 'chunks'} of {preview.pages} pages ·
            found <strong>{preview.found}</strong> question(s) · <strong>{withVars}</strong> with variables ·
            cost ₹{preview.cost?.inr} ({preview.model})
          </p>
          {preview.truncated && (
            <p className="text-xs text-amber-700 mt-1">
              This is only a sample. Full extraction will cost roughly{' '}
              <strong>₹{((preview.cost?.inr || 0) * (preview.total / Math.max(1, preview.processed))).toFixed(0)}</strong>.
            </p>
          )}
        </div>
        <button onClick={onClose} className="text-amber-700 hover:text-amber-900 text-lg leading-none">✕</button>
      </div>
      <div className="space-y-3 max-h-[420px] overflow-y-auto">
        {preview.questions.map((q, i) => (
          <div key={i} className="bg-white rounded-xl p-3 border border-amber-100">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${TYPE_STYLE[q.questionType] || 'bg-gray-100 text-gray-600'}`}>{q.questionType}</span>
              {q.marks != null && <span className="text-[10px] text-gray-500">{q.marks} marks</span>}
              <span className="text-[10px] text-gray-400">{q.difficulty}</span>
              <span className="text-[10px] text-gray-400">· {(q.variables || []).length} variable(s)</span>
            </div>
            <MarkdownBlock text={q.questionText} className="text-sm text-gray-800" />
            {q.answerText && (
              <details className="mt-2">
                <summary className="text-xs text-indigo-600 cursor-pointer font-semibold">Show answer</summary>
                <MarkdownBlock text={q.answerText} className="text-xs text-gray-600 mt-1" />
              </details>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

function QuestionCard({ q, busy, onStatus, onDelete }) {
  const vars = q.originalQuestion?.variables || []
  return (
    <div className="border border-gray-100 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${TYPE_STYLE[q.questionType] || 'bg-gray-100 text-gray-600'}`}>{q.questionType}</span>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_STYLE[q.status]}`}>{q.status}</span>
        {q.originalQuestion?.marks != null && <span className="text-[10px] text-gray-500">{q.originalQuestion.marks} marks</span>}
        <span className="text-[10px] text-gray-400">{q.difficulty}</span>
        <span className="text-[10px] text-gray-400">· {vars.length} variable(s)</span>
        <div className="ml-auto flex items-center gap-1.5">
          {q.status !== 'published' && (
            <button onClick={() => onStatus('published')} disabled={busy}
              className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-semibold hover:bg-emerald-100 disabled:opacity-50">Publish</button>
          )}
          {q.status === 'published' && (
            <button onClick={() => onStatus('draft')} disabled={busy}
              className="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-700 text-xs font-semibold hover:bg-amber-100 disabled:opacity-50">Unpublish</button>
          )}
          <button onClick={onDelete} disabled={busy}
            className="px-2 py-1 rounded-lg text-gray-400 hover:text-red-500 text-xs font-semibold disabled:opacity-50">✕</button>
        </div>
      </div>

      <MarkdownBlock text={q.originalQuestion?.text} className="text-sm text-gray-800" />

      {vars.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {vars.map((v, i) => (
            <span key={i} className="text-[10px] bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded font-medium"
              title={`${v.label} — range ${v.minRange ?? '?'}–${v.maxRange ?? '?'}`}>
              {v.label}: {String(v.value)}{v.unit}
            </span>
          ))}
        </div>
      )}

      <details className="mt-2">
        <summary className="text-xs text-indigo-600 cursor-pointer font-semibold">Show answer</summary>
        <MarkdownBlock text={q.originalAnswer?.text} className="text-xs text-gray-600 mt-1" />
      </details>
    </div>
  )
}
