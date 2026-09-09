// Chapter Progress — one paper at a time, every enrolled student against every
// chapter/unit of it, laid out the way the tutoring sheet is. Each cell shows
// where the student stands on the ladder the LMS computes from live classes
// (not allotted → allotted → attended → completed), and a click sets the
// admin's own mark for work done before the LMS tracked it:
//
//   blank → ✓ Completed → ✗ Absent → blank
//
// Every click saves at once and the cell re-renders from the server's verdict,
// so what you see here is exactly what the scheduler picker and the student's
// Progress page will show. Marks are per student per unit (or per chapter when
// it has no units) — the grain classes are booked at.
import { useState, useEffect, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../../api'
import { groupLabel } from '../../lib/ca'

const SUBJECT_KEY = 'admin-chapter-progress-subject'
const ATTEMPT_KEY = 'admin-chapter-progress-attempt'
// Filter value for students with no attempt set yet.
const NO_ATTEMPT = '__none__'

// What a click turns the current mark into.
const NEXT_MARK = { none: 'completed', completed: 'absent', absent: null }

// "Jan 2027" → sortable number, so batches list in calendar order.
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
function attemptOrder(a) {
  const m = String(a || '').trim().match(/^([a-z]{3})[a-z]*\s+(\d{4})$/i)
  if (!m) return Number.MAX_SAFE_INTEGER
  return Number(m[2]) * 12 + Math.max(0, MONTHS.indexOf(m[1].toLowerCase()))
}

// Column headings are tight, so drop the "Chapter 3:" / "Unit 2:" prefixes and
// shorten "Accounting Standard 12" to "AS 12". Full names stay in the tooltip.
function shortLabel(name) {
  return String(name || '')
    .replace(/^\s*(chapter|chap|unit)\s*\.?\s*\d+\s*[:.\-–]\s*/i, '')
    .replace(/accounting standard\s+(\d+)/i, 'AS $1')
    .trim()
}

// How a cell paints: the admin's own mark wins, else the live-class rung.
function cellLook(cell) {
  const mark = cell?.manualMark || null
  const by = cell?.markedByName ? ` — marked by ${cell.markedByName}` : ''
  if (mark === 'completed') return { glyph: '✓', cls: 'bg-emerald-600 text-white', title: `Completed (hand-set)${by}` }
  if (mark === 'absent')    return { glyph: '✗', cls: 'bg-rose-500 text-white',    title: `Absent (hand-set)${by}` }
  switch (cell?.status) {
    case 'completed': return { glyph: '✓', cls: 'bg-emerald-100 text-emerald-700', title: 'Completed through live classes' }
    case 'attended':  return { glyph: '◐', cls: 'bg-amber-100 text-amber-700',     title: 'Attended a class, not completed yet' }
    case 'allotted':  return { glyph: '·', cls: 'bg-indigo-100 text-indigo-700',   title: 'A class is allotted' }
    default:          return { glyph: '',  cls: 'bg-gray-50 text-gray-300',        title: 'No class yet' }
  }
}

const LEGEND = [
  { cls: 'bg-emerald-600 text-white',       glyph: '✓', text: 'Completed (hand-set)' },
  { cls: 'bg-emerald-100 text-emerald-700', glyph: '✓', text: 'Completed via classes' },
  { cls: 'bg-amber-100 text-amber-700',     glyph: '◐', text: 'Attended' },
  { cls: 'bg-indigo-100 text-indigo-700',   glyph: '·', text: 'Allotted' },
  { cls: 'bg-rose-500 text-white',          glyph: '✗', text: 'Absent (hand-set)' },
  { cls: 'bg-gray-50 text-gray-300 border border-gray-200', glyph: '', text: 'Nothing yet' },
]

const selectCls = 'text-sm px-3 py-2 bg-white border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400'

export default function ChapterProgressPage() {
  const [subjects, setSubjects] = useState([])
  const [subjectId, setSubjectId] = useState(() => { try { return localStorage.getItem(SUBJECT_KEY) || '' } catch { return '' } })
  const [query, setQuery] = useState('')
  const [onlyPending, setOnlyPending] = useState(false)
  // Batch = the student's attempt ("Jan 2027"); '' shows every batch.
  const [attempt, setAttempt] = useState(() => { try { return localStorage.getItem(ATTEMPT_KEY) || '' } catch { return '' } })
  useEffect(() => { try { localStorage.setItem(ATTEMPT_KEY, attempt) } catch { /* private mode */ } }, [attempt])

  // `key` is the subject the held grid belongs to — anything else is loading.
  const [state, setState] = useState({ key: null, grid: null, error: '' })
  const [saving, setSaving] = useState(() => new Set())
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)

  useEffect(() => {
    let alive = true
    apiFetch('/api/admin/subjects')
      .then((d) => {
        if (!alive) return
        const list = (Array.isArray(d) ? d : d.subjects || []).filter((s) => s.isActive !== false && (s.chapters || []).length)
        setSubjects(list)
        setSubjectId((cur) => (cur && list.some((s) => String(s._id) === cur)) ? cur : (list[0] ? String(list[0]._id) : ''))
      })
      .catch((e) => alive && setState({ key: null, grid: null, error: e.message || 'Failed to load subjects' }))
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (!subjectId) return
    try { localStorage.setItem(SUBJECT_KEY, subjectId) } catch { /* private mode */ }
    let alive = true
    apiFetch(`/api/admin/chapter-progress?subjectId=${subjectId}`)
      .then((d) => alive && setState({ key: subjectId, grid: d, error: '' }))
      .catch((e) => alive && setState((prev) => ({ key: subjectId, grid: prev.grid, error: e.message || 'Failed to load' })))
    return () => { alive = false }
  }, [subjectId])

  const settled = state.key === subjectId
  const grid = settled ? state.grid : null
  const loading = !!subjectId && !settled && !state.error

  function flash(text, bad = false) {
    clearTimeout(toastTimer.current)
    setToast({ text, bad })
    toastTimer.current = setTimeout(() => setToast(null), 1800)
  }

  async function cycle(student, col) {
    const cell = student.cells[col.key]
    const next = NEXT_MARK[cell?.manualMark || 'none']
    const k = `${student.id}|${col.key}`
    if (saving.has(k)) return
    setSaving((s) => new Set(s).add(k))
    try {
      const res = await apiFetch(`/api/admin/users/${student.id}/chapter-status`, {
        method: 'PUT',
        body: JSON.stringify({ subjectId, chapterId: col.chapterId, unitId: col.unitId, mark: next }),
      })
      const fresh = { status: res.status, manualMark: res.manualMark, markedByName: res.markedByName }
      setState((prev) => ({
        ...prev,
        grid: prev.grid && {
          ...prev.grid,
          students: prev.grid.students.map((s) => (s.id === student.id ? { ...s, cells: { ...s.cells, [col.key]: fresh } } : s)),
        },
      }))
      flash(next === 'completed' ? `✓ ${student.name || 'Student'} · ${shortLabel(col.unitName || col.chapterName)}`
        : next === 'absent' ? `✗ ${student.name || 'Student'} · ${shortLabel(col.unitName || col.chapterName)}`
        : `Cleared · ${student.name || 'Student'}`)
    } catch (e) {
      flash(e.message || 'Could not save', true)
    } finally {
      setSaving((s) => { const n = new Set(s); n.delete(k); return n })
    }
  }

  // Columns grouped by chapter for the two-row header.
  const groups = useMemo(() => {
    const out = []
    for (const col of grid?.columns || []) {
      const last = out[out.length - 1]
      if (last && last.chapterId === col.chapterId) last.cols.push(col)
      else out.push({ chapterId: col.chapterId, chapterName: col.chapterName, cols: [col] })
    }
    return out
  }, [grid])

  const columns = grid?.columns || []
  const isDone = (cell) => cell?.manualMark === 'completed' || (cell?.manualMark !== 'absent' && cell?.status === 'completed')
  const q = query.trim().toLowerCase()
  const rows = (grid?.students || [])
    .map((s) => ({ ...s, done: columns.filter((c) => isDone(s.cells[c.key])).length }))
    .filter((s) => !attempt || (attempt === NO_ATTEMPT ? !s.caAttempt : s.caAttempt === attempt))
    .filter((s) => !q || s.name.toLowerCase().includes(q) || s.phoneNumber.includes(q))
    .filter((s) => !onlyPending || s.done < columns.length)

  // The batches present among this paper's students, in calendar order, with
  // a count each; "no batch set" listed last when anyone lacks one.
  const attempts = useMemo(() => {
    const counts = new Map()
    let none = 0
    for (const s of grid?.students || []) {
      if (s.caAttempt) counts.set(s.caAttempt, (counts.get(s.caAttempt) || 0) + 1)
      else none += 1
    }
    const list = [...counts.entries()].sort((a, b) => attemptOrder(a[0]) - attemptOrder(b[0]))
      .map(([value, n]) => ({ value, label: `${value} · ${n}` }))
    if (none) list.push({ value: NO_ATTEMPT, label: `No batch set · ${none}` })
    return list
  }, [grid])

  const byLevel = useMemo(() => {
    const m = new Map()
    for (const s of subjects) { if (!m.has(s.level)) m.set(s.level, []); m.get(s.level).push(s) }
    return [...m.entries()]
  }, [subjects])

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Chapter Progress</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            Students × chapters for one paper. Click a cell: blank → ✓ completed → ✗ absent → blank. Saves at once.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 ml-auto">
          <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} className={selectCls}>
            {!subjects.length && <option value="">Loading papers…</option>}
            {byLevel.map(([level, list]) => (
              <optgroup key={level} label={level}>
                {list.map((s) => (
                  <option key={s._id} value={String(s._id)}>
                    {s.name}{s.group ? ` · ${groupLabel(s.group)}` : ''}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <select value={attempt} onChange={(e) => setAttempt(e.target.value)} className={selectCls} title="Batch (attempt)">
            <option value="">All batches{grid ? ` · ${grid.students.length}` : ''}</option>
            {attempts.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search student or phone…"
            className={`${selectCls} w-52`} />
          <label className="flex items-center gap-1.5 text-xs text-gray-500 select-none">
            <input type="checkbox" checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} />
            Hide fully completed students
          </label>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {LEGEND.map((l) => (
          <span key={l.text} className="flex items-center gap-1.5 text-[11px] text-gray-500">
            <span className={`inline-flex items-center justify-center w-5 h-5 rounded text-[11px] font-bold ${l.cls}`}>{l.glyph}</span>
            {l.text}
          </span>
        ))}
        <span className="text-[11px] text-gray-400 ml-auto">
          Students appear once their level and group are set (Users → Course). Hand-set marks never count as attendance.
        </span>
      </div>

      {state.error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-xl px-4 py-3">{state.error}</div>
      )}

      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-sm text-gray-400">Loading {subjects.find((s) => String(s._id) === subjectId)?.name || 'paper'}…</div>
        ) : !grid ? (
          <div className="p-10 text-center text-sm text-gray-400">Pick a paper to begin.</div>
        ) : !columns.length ? (
          <div className="p-10 text-center text-sm text-gray-400">{grid.subject.name} has no chapters yet — add them under Subjects.</div>
        ) : (
          <div className="overflow-auto max-h-[78vh]">
            <table className="border-separate border-spacing-0 text-xs">
              <thead>
                <tr>
                  <th rowSpan={2}
                    className="sticky left-0 top-0 z-30 bg-white border-b border-r border-gray-200 px-3 py-2 text-left font-semibold text-gray-500 min-w-[220px]">
                    Student <span className="font-normal text-gray-400">· {rows.length}</span>
                  </th>
                  {groups.map((g) => (
                    <th key={g.chapterId} colSpan={g.cols.length} rowSpan={g.cols.length === 1 && !g.cols[0].unitId ? 2 : 1}
                      title={g.chapterName}
                      className={`sticky top-0 z-20 bg-white border-b border-l border-gray-100 px-1 py-1.5 font-semibold text-gray-600 align-bottom ${
                        g.cols.length === 1 ? 'w-14 min-w-[56px]' : ''}`}>
                      <div className={`leading-tight break-words ${g.cols.length === 1 ? 'text-[10px]' : 'text-[10px] uppercase tracking-wide text-gray-400'}`}
                        style={{ maxWidth: g.cols.length === 1 ? 56 : g.cols.length * 56 }}>
                        {shortLabel(g.chapterName)}
                      </div>
                    </th>
                  ))}
                  <th rowSpan={2} className="sticky top-0 z-20 bg-white border-b border-l border-gray-200 px-2 py-2 font-semibold text-gray-500 min-w-[56px]">Done</th>
                </tr>
                <tr>
                  {groups.flatMap((g) => (g.cols.length === 1 && !g.cols[0].unitId ? [] : g.cols.map((c) => (
                    <th key={c.key} title={`${c.chapterName} / ${c.unitName}`}
                      className="sticky top-[33px] z-20 bg-white border-b border-l border-gray-100 px-1 py-1 font-medium text-gray-500 w-14 min-w-[56px] align-bottom">
                      <div className="text-[10px] leading-tight break-words" style={{ maxWidth: 56 }}>{shortLabel(c.unitName)}</div>
                    </th>
                  ))))}
                </tr>
              </thead>
              <tbody>
                {!rows.length && (
                  <tr><td colSpan={columns.length + 2} className="px-4 py-8 text-center text-gray-400">
                    {grid.students.length ? 'No student matches this batch, search or filter.' : 'No student is enrolled for this paper yet.'}
                  </td></tr>
                )}
                {rows.map((s) => (
                  <tr key={s.id} className="group">
                    <td className="sticky left-0 z-10 bg-white group-hover:bg-gray-50 border-b border-r border-gray-100 px-3 py-1">
                      <Link to={`/admin/users/${s.id}/progress`} className="font-medium text-gray-900 hover:text-indigo-600 truncate block max-w-[200px]"
                        title={`${s.name} · ${s.phoneNumber}`}>
                        {s.name || s.phoneNumber}
                      </Link>
                      <p className="text-[10px] text-gray-400 truncate">
                        {s.phoneNumber}{s.caAttempt ? ` · ${s.caAttempt}` : ''}{s.caGroup ? ` · ${groupLabel(s.caGroup)}` : ''}{!s.enrolled ? ' · not enrolled here' : ''}
                      </p>
                    </td>
                    {columns.map((c) => {
                      const cell = s.cells[c.key]
                      const look = cellLook(cell)
                      const busy = saving.has(`${s.id}|${c.key}`)
                      return (
                        <td key={c.key} className="border-b border-l border-gray-50 p-0.5 text-center group-hover:bg-gray-50">
                          <button type="button" onClick={() => cycle(s, c)} disabled={busy}
                            title={`${s.name || s.phoneNumber} · ${shortLabel(c.unitName || c.chapterName)}: ${look.title}. Click to change.`}
                            className={`w-12 h-8 rounded-md font-bold text-sm transition-colors hover:ring-2 hover:ring-indigo-300 disabled:opacity-50 ${look.cls}`}>
                            {busy ? '…' : look.glyph}
                          </button>
                        </td>
                      )
                    })}
                    <td className="border-b border-l border-gray-100 px-2 py-1 text-center text-gray-500 group-hover:bg-gray-50 whitespace-nowrap">
                      <span className={s.done === columns.length ? 'text-emerald-600 font-semibold' : ''}>{s.done}</span>
                      <span className="text-gray-300">/{columns.length}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {toast && (
        <div className={`fixed bottom-5 right-5 z-50 px-4 py-2.5 rounded-xl shadow-lg text-sm text-white ${toast.bad ? 'bg-rose-600' : 'bg-gray-900'}`}>
          {toast.text}
        </div>
      )}
    </div>
  )
}
