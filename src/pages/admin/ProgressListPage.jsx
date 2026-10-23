// Admin → Progress. Every student on one list with the few numbers that say
// whether they need a look: attendance, test score, when they joined and what
// they're enrolled for. A row opens the full report (StudentProgressPage).
//
// Backed by /api/admin/progress-overview, which uses the report's own rules so
// a row and its report never disagree.
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../../api'
import { enrollmentLabel, CA_LEVELS } from '../../lib/ca'

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
  const [sort, setSort]       = useState({ key: 'joined', dir: 'desc' })
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')

  useEffect(() => {
    setLoading(true)
    const query = new URLSearchParams({
      page, limit: pageSize, sort: sort.key, dir: sort.dir, show,
      ...(search && { search }),
      ...(level && { level }),
      ...(batch && { batch }),
    })
    apiFetch(`/api/admin/progress-overview?${query}`)
      .then(d => {
        setRows(d.students || [])
        setCounts(d.counts || null)
        setBatches(d.batches || [])
        setTotal(d.pagination?.total || 0)
        setError('')
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [page, pageSize, search, show, level, batch, sort])

  // AdminLayout's <main> is the scroller — jump back to the top on a new page.
  useEffect(() => { document.querySelector('main')?.scrollTo({ top: 0 }) }, [page, pageSize])

  function sortBy(key) {
    if (!key) return
    // Names read best A→Z; numbers and dates are most useful highest first.
    setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' ? 'asc' : 'desc' })
    setPage(1)
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

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
        {SHOW_OPTIONS.map(o => (
          <button key={o.key} onClick={() => { setShow(o.key); setPage(1) }}
            className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${
              show === o.key ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}>
            {o.label}{counts ? ` · ${counts[o.key]}` : ''}
          </button>
        ))}
      </div>

      {error && <p className="mb-4 text-sm text-rose-600 bg-rose-50 rounded-xl px-4 py-3">{error}</p>}

      <div className="bg-white rounded-2xl shadow-sm overflow-x-auto">
        <table className="w-full min-w-max text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-xs font-semibold text-gray-400 uppercase tracking-wide">
              {COLUMNS.map(c => (
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
                  {COLUMNS.map((c) => (
                    <td key={c.label} className="px-5 py-3.5"><div className="h-4 bg-gray-100 rounded animate-pulse w-24" /></td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr><td colSpan={COLUMNS.length} className="px-5 py-10 text-center text-gray-400">No students found</td></tr>
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
                        <p className="font-medium text-gray-900">{s.name || '—'}</p>
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
                  </td>
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
