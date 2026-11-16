// Admin → Progress. Every student on one list with the few numbers that say
// whether they need a look: attendance, test score, when they joined and what
// they're enrolled for. A row opens the full report (StudentProgressPage).
//
// Backed by /api/admin/progress-overview, which uses the report's own rules so
// a row and its report never disagree.
import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch, authHeaders } from '../../api'
import { enrollmentLabel, CA_LEVELS } from '../../lib/ca'
import { usePrograms, programNames, programFilterOptions } from '../../lib/programs'
import { normalizeProgressFilter, serializeProgressFilter, progressConditionComplete, progressRowProblem, describeFilter } from '../../lib/progressFilter'
import ProgressFilterPanel, { PROGRESS_VIEW_SCOPE } from '../../components/ProgressFilterPanel'

// The Advanced filter survives opening a student's report and coming back.
const ADV_STORAGE_KEY = 'admin-progress-adv-filter'
const EMPTY_ADV = { conditions: [] }
function loadStoredAdv() {
  try { return normalizeProgressFilter(JSON.parse(sessionStorage.getItem(ADV_STORAGE_KEY) || 'null')) }
  catch { return EMPTY_ADV }
}

// Re-asking the server on every keystroke in a "last N days" box is wasteful.
function useDebounced(value, ms) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

function fmtDay(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

// Same thresholds as the full report, so a colour means the same on both.
function toneFor(percent) {
  if (percent == null) return 'gray'
  if (percent >= 75) return 'emerald'
  if (percent >= 50) return 'amber'
  return 'rose'
}
const BAR_TONES  = { emerald: 'bg-emerald-500', amber: 'bg-amber-500', rose: 'bg-rose-500', gray: 'bg-gray-300' }
const TEXT_TONES = { emerald: 'text-emerald-600', amber: 'text-amber-600', rose: 'text-rose-600', gray: 'text-gray-400' }

function PercentCell({ percent, empty, detail }) {
  if (percent == null) return <span className="text-xs text-gray-400">{empty}</span>
  const tone = toneFor(percent)
  return (
    <div className="w-32">
      <div className="flex items-baseline justify-between gap-2">
        <span className={`text-sm font-bold ${TEXT_TONES[tone]}`}>{percent}%</span>
        <span className="text-[11px] text-gray-400 whitespace-nowrap">{detail}</span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mt-1">
        <div className={`h-full rounded-full ${BAR_TONES[tone]}`} style={{ width: `${Math.min(100, percent)}%` }} />
      </div>
    </div>
  )
}

const SHOW_OPTIONS = [
  { key: 'all',     label: 'All students' },
  { key: 'classes', label: 'Attending classes' },
  { key: 'tests',   label: 'Writing tests' },
  { key: 'none',    label: 'No activity yet' },
  // Only offered while some student actually has that label (counts > 0).
  { key: 'group-completed',  count: 'groupCompleted',  label: 'Group completed',  optional: true },
  { key: 'level-completed',  count: 'levelCompleted',  label: 'Level completed',  optional: true },
  { key: 'course-completed', count: 'courseCompleted', label: 'Course completed', optional: true },
]

const COLUMNS = [
  { key: 'name',       label: 'Student' },
  { key: null,         label: 'Enrolled for' },
  { key: 'joined',     label: 'Joined' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'tests',      label: 'Test score' },
  { key: 'lastClass',  label: 'Last class' },
]

export default function ProgressListPage() {
  const navigate = useNavigate()
  const [rows, setRows]       = useState([])
  const [counts, setCounts]   = useState(null)
  const [total, setTotal]     = useState(0)
  const [page, setPage]       = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [search, setSearch]   = useState('')
  const [show, setShow]       = useState('all')
  const [level, setLevel]     = useState('')
  const [batch, setBatch]     = useState('')
  const [batches, setBatches] = useState([])
  const [allBatches, setAllBatches] = useState([])   // every sitting — Advanced filter's Batch choices
  const [program, setProgram] = useState('')   // program key | 'none' | '' (any)
  const programs = usePrograms()
  const [sort, setSort]       = useState({ key: 'joined', dir: 'desc' })
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')

  // ── Advanced filter (AND / OR condition rows, checked on the server) ──
  const [adv, setAdvRaw]      = useState(loadStoredAdv)
  const [advOpen, setAdvOpen] = useState(false)
  const [subjects, setSubjects] = useState(null)
  const [views, setViews]     = useState(null)
  const [activeViewId, setActiveViewId] = useState('')
  const advParam = useDebounced(useMemo(() => serializeProgressFilter(adv), [adv]), 350)
  // One request when typing pauses, not one per letter.
  const searchParam = useDebounced(search.trim(), 300)
  // The first load asks the server to rebuild its cached rows, so opening the
  // page always shows live numbers; clicks after that reuse the copy (≤30 s).
  const freshRef = useRef(true)
  const advCount = adv.conditions.filter(progressConditionComplete).length
  // Filled-in rows that can't apply as typed (e.g. 11111 days) — flagged on
  // the button so nobody reads the list as if they were applied.
  const advNotApplied = adv.conditions.filter(c => progressRowProblem(c)).length
  // Every change restarts at page 1. A loaded saved view stays highlighted
  // while it's edited, so "Update" can overwrite it.
  const setAdv = (next) => { setAdvRaw(next); setPage(1) }

  useEffect(() => {
    try { sessionStorage.setItem(ADV_STORAGE_KEY, JSON.stringify(adv)) } catch { /* storage full / blocked */ }
  }, [adv])

  useEffect(() => {
    apiFetch('/api/admin/subjects')
      .then(d => setSubjects((d.subjects || []).filter(s => s.isActive)))
      .catch(() => setSubjects([]))
    apiFetch(`/api/admin/filter-views?scope=${PROGRESS_VIEW_SCOPE}`)
      .then(d => setViews(d.views || []))
      .catch(() => setViews([]))
  }, [])

  useEffect(() => {
    // A slow answer to an older filter must never overwrite a newer one.
    let alive = true
    setLoading(true)
    const query = new URLSearchParams({
      page, limit: pageSize, sort: sort.key, dir: sort.dir, show,
      ...(searchParam && { search: searchParam }),
      ...(freshRef.current && { fresh: '1' }),
      ...(level && { level }),
      ...(batch && { batch }),
      ...(program && { program }),
      ...(advParam && { adv: advParam }),
    })
    apiFetch(`/api/admin/progress-overview?${query}`)
      .then(d => {
        if (!alive) return
        freshRef.current = false
        setRows(d.students || [])
        // Sorted by a paper's % whose condition is gone → the server fell back
        // to Joined; say so instead of showing a stale arrow.
        const cols = Object.keys(d.students?.[0]?.subjectProgress || {})
        if (sort.key.startsWith('subject:') && (d.students || []).length && !cols.includes(sort.key.slice(8))) {
          setSort({ key: 'joined', dir: 'desc' })
        }
        setCounts(d.counts || null)
        setBatches(d.batches || [])
        setAllBatches(d.allBatches || [])
        setTotal(d.pagination?.total || 0)
        setError('')
      })
      .catch(err => { if (alive) setError(err.message) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [page, pageSize, searchParam, show, level, batch, program, sort, advParam])

  // ── CSV download ── offered only while something narrows the list, and it
  // asks for exactly what the list shows (same filters, same sort), every
  // matching student rather than one page.
  const anyFilter = !!(level || batch || program || searchParam || show !== 'all' || advParam)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState('')
  async function downloadCsv() {
    setDownloading(true); setDownloadError('')
    try {
      const query = new URLSearchParams({
        sort: sort.key, dir: sort.dir, show,
        ...(searchParam && { search: searchParam }),
        ...(level && { level }),
        ...(batch && { batch }),
        ...(program && { program }),
        ...(advParam && { adv: advParam }),
      })
      const res = await fetch(`${import.meta.env.VITE_API_BASE}/api/admin/progress-overview/export?${query}`, { headers: authHeaders() })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not make the file')
      const blob = await res.blob()
      // progress-intermediate-jan-2027-class-advanced-2026-11-16.csv
      const parts = [level, batch, program, show !== 'all' && show, advParam && 'advanced', searchParam && 'search']
        .filter(Boolean).map(x => String(x).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))
      const day = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10)
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `progress-${[...parts, day].join('-')}.csv`
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(a.href), 60_000)
    } catch (e) {
      setDownloadError(e.message || 'Could not make the file')
    } finally {
      setDownloading(false)
    }
  }

  // A saved view holds the page's quick filters too, so one click restores
  // "Inter · Jan 2027 · (Follow-up AND slot 1) OR joined this week".
  const currentView = () => ({ quick: { level, batch, program, show }, ...adv })
  const applyView = (v) => {
    const q = v.filters?.quick || {}
    setLevel(q.level || ''); setBatch(q.batch || ''); setProgram(q.program || ''); setShow(q.show || 'all')
    setAdv(normalizeProgressFilter(v.filters))
    setActiveViewId(String(v._id))
  }
  const clearAllFilters = () => {
    setLevel(''); setBatch(''); setProgram(''); setShow('all'); setSearch('')
    setAdv(EMPTY_ADV); setActiveViewId('')
  }

  // AdminLayout's <main> is the scroller — jump back to the top on a new page.
  useEffect(() => { document.querySelector('main')?.scrollTo({ top: 0 }) }, [page, pageSize])

  function sortBy(key) {
    if (!key) return
    // Names read best A→Z; numbers and dates are most useful highest first.
    // A paper's % starts lowest first — the students to reschedule.
    setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: key === 'name' || key.startsWith('subject:') ? 'asc' : 'desc' })
    setPage(1)
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  // One "% topics done" column per paper a Subject progress condition names,
  // right after "Enrolled for". Taken from the answer itself, so the columns
  // always match the rows on screen.
  const subjectName = (id) => {
    const sub = (subjects || []).find(x => String(x._id).toLowerCase() === id)
    return sub ? sub.name : subjects ? 'Inactive subject' : 'Subject'
  }
  const progressCols = Object.keys(rows[0]?.subjectProgress || {})
    .map(id => ({ key: `subject:${id}`, label: `${subjectName(id)} %`, subjectId: id }))
  const columns = [...COLUMNS.slice(0, 2), ...progressCols, ...COLUMNS.slice(2)]

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Progress</h1>
          <p className="text-gray-400 text-sm mt-0.5">
            {total} student{total !== 1 ? 's' : ''} · click a student for the full progress report
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* A batch belongs to a level, so changing level clears the batch. */}
          <select value={level} onChange={e => { setLevel(e.target.value); setBatch(''); setPage(1) }}
            className="py-2 px-3 border border-gray-200 rounded-xl text-sm bg-white outline-none focus:ring-2 focus:ring-indigo-500">
            <option value="">All levels</option>
            {CA_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
            <option value="none">Level not set</option>
          </select>
          <select value={batch} onChange={e => { setBatch(e.target.value); setPage(1) }}
            className="py-2 px-3 border border-gray-200 rounded-xl text-sm bg-white outline-none focus:ring-2 focus:ring-indigo-500">
            <option value="">All batches</option>
            {batches.map(b => <option key={b} value={b}>{b}</option>)}
            <option value="none">Batch not set</option>
          </select>
          <select value={program} onChange={e => { setProgram(e.target.value); setPage(1) }}
            className="py-2 px-3 border border-gray-200 rounded-xl text-sm bg-white outline-none focus:ring-2 focus:ring-indigo-500">
            <option value="">All programs</option>
            {programFilterOptions(programs).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button onClick={() => setAdvOpen(true)}
            title={advNotApplied ? `${advNotApplied} condition${advNotApplied > 1 ? 's are' : ' is'} not applied — open to fix` : undefined}
            className={`py-2 px-3 rounded-xl text-sm font-semibold border transition-colors ${
              advNotApplied ? 'bg-amber-50 text-amber-800 border-amber-400'
                : advCount ? 'bg-indigo-50 text-indigo-700 border-indigo-400' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
            ⚙ Advanced{advCount ? ` · ${advCount > 1 ? describeFilter(adv.conditions, progressConditionComplete) : 1}` : ''}
            {advNotApplied > 0 && ` · ⚠ ${advNotApplied} not applied`}
          </button>
          {(advCount > 0 || advNotApplied > 0) && (
            <button onClick={() => { setAdv(EMPTY_ADV); setActiveViewId('') }}
              title="Remove every advanced condition"
              className="text-xs font-semibold text-gray-400 hover:text-red-500">
              Clear
            </button>
          )}
          {anyFilter && (
            <button onClick={downloadCsv} disabled={downloading || loading || total === 0}
              title={total === 0 ? 'No students to download' : `Download all ${total} matching students as a CSV file (opens in Excel / Google Sheets)`}
              className="py-2 px-3 rounded-xl text-sm font-semibold border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 disabled:cursor-not-allowed">
              {downloading ? 'Preparing…' : `⬇ Download CSV · ${total}`}
            </button>
          )}
          <div className="relative">
            <svg className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input type="text" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
              placeholder="Search name or phone..."
              className="pl-9 pr-4 py-2 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 w-64" />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {SHOW_OPTIONS
          // A completion chip appears only when someone has that label — or while it is the active filter.
          .filter(o => !o.optional || show === o.key || (counts?.[o.count] || 0) > 0)
          .map(o => (
            <button key={o.key} onClick={() => { setShow(o.key); setPage(1) }}
              className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${
                show === o.key ? (o.optional ? 'bg-emerald-600 text-white' : 'bg-indigo-600 text-white')
                  : o.optional ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100'
                  : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}>
              {o.optional && '🎓 '}{o.label}{counts ? ` · ${counts[o.count || o.key] ?? 0}` : ''}
            </button>
          ))}
      </div>

      {error && <p className="mb-4 text-sm text-rose-600 bg-rose-50 rounded-xl px-4 py-3">{error}</p>}
      {downloadError && <p className="mb-4 text-sm text-rose-600 bg-rose-50 rounded-xl px-4 py-3">Download failed: {downloadError}</p>}

      <div className="bg-white rounded-2xl shadow-sm overflow-x-auto">
        <table className="w-full min-w-max text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-xs font-semibold text-gray-400 uppercase tracking-wide">
              {columns.map(c => (
                <th key={c.label} className="text-left px-5 py-3.5">
                  {c.key ? (
                    <button onClick={() => sortBy(c.key)}
                      className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-gray-700 ${sort.key === c.key ? 'text-gray-700' : ''}`}>
                      {c.label}
                      <span className="text-[10px]">{sort.key === c.key ? (sort.dir === 'asc' ? '▲' : '▼') : ''}</span>
                    </button>
                  ) : c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array(8).fill(0).map((_, i) => (
                <tr key={i} className="border-b border-gray-50">
                  {columns.map((c) => (
                    <td key={c.label} className="px-5 py-3.5"><div className="h-4 bg-gray-100 rounded animate-pulse w-24" /></td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr><td colSpan={columns.length} className="px-5 py-10 text-center text-gray-400">
                {advCount ? 'No students match these filters' : 'No students found'}
              </td></tr>
            ) : rows.map(s => {
              const enrol = enrollmentLabel(s)
              return (
                <tr key={s.id} onClick={() => navigate(`/admin/users/${s.id}/progress`)}
                  className="border-b border-gray-50 hover:bg-gray-50 transition-colors cursor-pointer">
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center text-xs font-bold text-indigo-600 flex-shrink-0">
                        {s.name?.[0]?.toUpperCase() || '?'}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900">
                          {s.name || '—'}
                          {s.completion && (
                            <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-emerald-100 text-emerald-700 uppercase tracking-wide">
                              🎓 {s.completion.label}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-gray-400">{s.phoneNumber || '—'}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 max-w-[260px]">
                    {s.courses.length > 0 ? (
                      <p className="text-gray-700 truncate" title={s.courses.join('\n')}>
                        {s.courses[0]}
                        {s.courses.length > 1 && <span className="text-gray-400"> +{s.courses.length - 1} more</span>}
                      </p>
                    ) : <p className="text-gray-400 text-xs">No course</p>}
                    {enrol && <p className="text-[11px] text-indigo-500 mt-0.5">{enrol}</p>}
                    {programNames(s.programs, programs) && (
                      <p className="text-[11px] font-semibold text-amber-700 mt-0.5">{programNames(s.programs, programs)}</p>
                    )}
                  </td>
                  {progressCols.map(c => {
                    const p = s.subjectProgress?.[c.subjectId]
                    return (
                      <td key={c.key} className="px-5 py-3.5">
                        {p
                          ? <PercentCell percent={p.percent} detail={`${p.done}/${p.total} topics`} />
                          : <span className="text-xs text-gray-400">Not studying</span>}
                      </td>
                    )
                  })}
                  <td className="px-5 py-3.5 text-gray-500 text-xs whitespace-nowrap">{fmtDay(s.createdAt)}</td>
                  <td className="px-5 py-3.5">
                    <PercentCell
                      percent={s.attendance.sessions ? s.attendance.percent : null}
                      empty="No classes yet"
                      detail={`${s.attendance.present}/${s.attendance.sessions} classes`} />
                  </td>
                  <td className="px-5 py-3.5">
                    <PercentCell
                      percent={s.tests.evaluated ? s.tests.averagePercent : null}
                      empty={s.tests.submitted ? `${s.tests.submitted} awaiting check` : 'No tests yet'}
                      detail={`${s.tests.evaluated} checked${s.tests.pending ? ` · ${s.tests.pending} pending` : ''}`} />
                  </td>
                  <td className="px-5 py-3.5 text-gray-500 text-xs whitespace-nowrap">{fmtDay(s.attendance.lastClassAt)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {advOpen && (
        <ProgressFilterPanel
          filter={adv} setFilter={setAdv}
          subjects={subjects} programs={programs} allBatches={allBatches}
          views={views} setViews={setViews}
          activeViewId={activeViewId} setActiveViewId={setActiveViewId}
          currentView={currentView} onApplyView={applyView}
          onClearAll={clearAllFilters}
          matchCount={total} loading={loading}
          onClose={() => setAdvOpen(false)}
        />
      )}

      {total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 mt-4 text-sm text-gray-500">
          <div className="flex items-center gap-2">
            <span>Rows</span>
            <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1) }}
              className="border border-gray-200 rounded-lg px-2 py-1 text-sm bg-white">
              {[20, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
              className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white disabled:opacity-40 hover:bg-gray-50">Prev</button>
            <span>Page {page} of {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
              className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white disabled:opacity-40 hover:bg-gray-50">Next</button>
          </div>
        </div>
      )}
    </div>
  )
}
