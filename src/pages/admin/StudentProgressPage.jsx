// Admin → Users → Progress. One student, everything we know about them:
// syllabus completion, live-class attendance, test-series marks and lecture
// watch history. Replaces the old Chapter Progress modal — a modal couldn't
// hold paginated logs, and this is the screen an admin sits with on a call.
//
// Three requests back it: /report (header, KPIs, subject tree — one bounded
// document), plus /attendance-log and /test-marks, which are paginated and
// filtered independently because a year of classes is not one payload. The
// lecture list reuses the existing /progress endpoint.
import { useState, useEffect, useMemo, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { apiFetch } from '../../api'
import { enrollmentLabel } from '../../lib/ca'

// ───────────────────────────── formatting ─────────────────────────────

function fmtDay(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

function fmtDateTime(d) {
  if (!d) return '—'
  const date = new Date(d)
  return `${date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}, ` +
         `${date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}`
}

function fmtTime(d) {
  if (!d) return '—'
  return new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
}

function fmtSeconds(sec) {
  if (!sec) return '0m'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return `${Math.floor(sec)}s`
}

const fmtMs = (ms) => fmtSeconds(Math.round((ms || 0) / 1000))

// Colour a percentage the same way everywhere on the page, so a number's tone
// means the same thing whether it's attendance, marks or syllabus coverage.
function toneFor(percent) {
  if (percent == null) return 'gray'
  if (percent >= 75) return 'emerald'
  if (percent >= 50) return 'amber'
  return 'rose'
}

const BAR_TONES = { emerald: 'bg-emerald-500', amber: 'bg-amber-500', rose: 'bg-rose-500', gray: 'bg-gray-300', indigo: 'bg-indigo-500' }
const TEXT_TONES = { emerald: 'text-emerald-600', amber: 'text-amber-600', rose: 'text-rose-600', gray: 'text-gray-400', indigo: 'text-indigo-600' }
const SOFT_TONES = {
  emerald: 'bg-emerald-100 text-emerald-700',
  amber:   'bg-amber-100 text-amber-700',
  rose:    'bg-rose-100 text-rose-700',
  gray:    'bg-gray-100 text-gray-500',
  indigo:  'bg-indigo-100 text-indigo-700',
  blue:    'bg-blue-100 text-blue-700',
  violet:  'bg-violet-100 text-violet-700',
}

// ───────────────────────────── small building blocks ─────────────────────────────

function Bar({ percent, tone = 'emerald', className = '' }) {
  return (
    <div className={`h-1.5 bg-gray-100 rounded-full overflow-hidden ${className}`}>
      <div className={`h-full rounded-full transition-all ${BAR_TONES[tone]}`}
        style={{ width: `${Math.max(0, Math.min(100, percent || 0))}%` }} />
    </div>
  )
}

function Badge({ tone = 'gray', children, title }) {
  return (
    <span title={title}
      className={`text-[10px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wide whitespace-nowrap ${SOFT_TONES[tone]}`}>
      {children}
    </span>
  )
}

function Chip({ active, onClick, tone = 'indigo', children }) {
  return (
    <button type="button" onClick={onClick}
      className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap ${
        active ? SOFT_TONES[tone] : 'text-gray-400 hover:bg-gray-100'}`}>
      {children}
    </button>
  )
}

function StatCard({ label, value, tone = 'gray', sub, hint, bar }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm px-4 py-3.5 min-w-0">
      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 leading-tight ${TEXT_TONES[tone] || 'text-gray-900'}`}>{value}</p>
      {bar != null && <Bar percent={bar} tone={tone === 'gray' ? 'indigo' : tone} className="mt-2" />}
      {sub && <p className="text-xs text-gray-500 mt-1.5 truncate" title={sub}>{sub}</p>}
      {hint && <p className="text-[11px] text-gray-400 mt-0.5 truncate" title={hint}>{hint}</p>}
    </div>
  )
}

function Section({ id, index, title, subtitle, children }) {
  return (
    <section id={id} className="scroll-mt-4">
      <div className="mb-3">
        <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2">
          <span className="w-5 h-5 rounded-md bg-indigo-600 text-white text-[10px] font-bold flex items-center justify-center">{index}</span>
          {title}
        </h2>
        {subtitle && <p className="text-xs text-gray-400 mt-1 ml-7">{subtitle}</p>}
      </div>
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">{children}</div>
    </section>
  )
}

function Empty({ title, hint }) {
  return (
    <div className="text-center py-12 px-6 text-gray-400">
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="text-xs mt-1">{hint}</p>}
    </div>
  )
}

function TableSkeleton({ rows = 5, cols = 6 }) {
  return (
    <tbody>
      {Array(rows).fill(0).map((_, i) => (
        <tr key={i} className="border-b border-gray-50">
          {Array(cols).fill(0).map((_, j) => (
            <td key={j} className="px-5 py-3.5"><div className="h-3.5 bg-gray-100 rounded animate-pulse" /></td>
          ))}
        </tr>
      ))}
    </tbody>
  )
}

function Pager({ page, totalPages, total, onPage, unit }) {
  if (totalPages <= 1) {
    return total ? (
      <div className="px-5 py-3 border-t border-gray-100 text-xs text-gray-400">{total} {unit}</div>
    ) : null
  }
  return (
    <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100">
      <p className="text-xs text-gray-400">Page {page} of {totalPages} · {total} {unit}</p>
      <div className="flex gap-2">
        <button onClick={() => onPage(Math.max(1, page - 1))} disabled={page === 1}
          className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50">Previous</button>
        <button onClick={() => onPage(Math.min(totalPages, page + 1))} disabled={page === totalPages}
          className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50">Next</button>
      </div>
    </div>
  )
}

// A row of "12 Present" style counters above a log table. `title` labels the
// row when a section stacks more than one.
function Tallies({ items, title }) {
  return (
    <div className="flex items-center gap-5 px-5 py-3 border-b border-gray-100 flex-wrap">
      {title && <p className="w-16 text-[10px] font-bold text-gray-500 uppercase tracking-wide">{title}</p>}
      {items.map(t => (
        <div key={t.label} title={t.hint}>
          <p className={`text-base font-bold leading-tight ${TEXT_TONES[t.tone] || 'text-gray-900'}`}>{t.value}</p>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{t.label}</p>
        </div>
      ))}
    </div>
  )
}

// A class can cover several chapters; the log row lists every one of them.
const logTopics = (r) => (r.items?.length ? r.items : [r])
  .map(i => [i.chapter?.name, i.unit?.name].filter(Boolean).join(' · '))
  .filter(Boolean).join(', ')

const inputCls = 'text-xs px-3 py-1.5 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400 bg-white'

// Subject dropdown + date range — the same controls above both logs.
function LogFilters({ subjects, subjectId, onSubject, dateFrom, dateTo, onDate, onReset, status, children }) {
  const dirty = subjectId || dateFrom || dateTo || status
  return (
    <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-100 flex-wrap">
      {children}
      <div className="flex items-center gap-2 ml-auto flex-wrap">
        <select value={subjectId} onChange={e => onSubject(e.target.value)} className={`${inputCls} max-w-[220px]`}>
          <option value="">All subjects</option>
          {subjects.map(s => <option key={s.subjectId} value={s.subjectId}>{s.name}</option>)}
        </select>
        <input type="date" value={dateFrom} max={dateTo || undefined} onChange={e => onDate('from', e.target.value)} className={inputCls} />
        <span className="text-xs text-gray-300">to</span>
        <input type="date" value={dateTo} min={dateFrom || undefined} onChange={e => onDate('to', e.target.value)} className={inputCls} />
        {dirty && (
          <button onClick={onReset} className="text-xs font-semibold text-gray-400 hover:text-gray-700 px-2 py-1.5">Clear</button>
        )}
      </div>
    </div>
  )
}

// ───────────────────────────── data hook ─────────────────────────────

// One GET, re-run whenever the serialized query changes. Stale responses are
// dropped on unmount / re-fire so a slow page 1 can't overwrite a fast page 2.
function useResource(path, params) {
  const qs = useMemo(() => {
    const q = new URLSearchParams()
    Object.entries(params || {}).forEach(([k, v]) => { if (v !== '' && v != null) q.set(k, v) })
    const s = q.toString()
    return s ? `?${s}` : ''
  }, [params])
  const url = `${path}${qs}`

  // `key` is the url the held answer belongs to — anything else means we're
  // still waiting. Nothing is set synchronously here, and the last good payload
  // survives a filter change so the filter controls built from it don't blank.
  const [state, setState] = useState({ key: null, data: null, error: '' })
  // refresh() re-fetches the same url in place: the held answer stays on
  // screen (no skeleton) until the fresh one lands — for after an edit the
  // server has to re-judge, like a hand-set chapter mark.
  const [tick, setTick] = useState(0)
  const key = `${url}#${tick}`

  useEffect(() => {
    let alive = true
    apiFetch(url)
      .then(d => alive && setState({ key, data: d, error: '' }))
      .catch(e => alive && setState(prev => ({ key, data: prev.data, error: e.message || 'Failed to load' })))
    return () => { alive = false }
  }, [url, key])

  const settled = state.key === key
  const sameUrl = !!state.key && state.key.split('#')[0] === url
  return {
    data: state.data, error: settled ? state.error : '',
    loading: !settled && !sameUrl, refreshing: !settled && sameUrl,
    refresh: () => setTick(t => t + 1),
  }
}

// Open a presigned file in a new tab. The blank window is opened synchronously
// (before the await) so browsers don't treat it as a blocked popup.
async function openInTab(path, onError) {
  const win = window.open('', '_blank')
  try {
    const { url } = await apiFetch(path)
    if (win) win.location = url
    else window.location.href = url
  } catch (e) {
    if (win) win.close()
    onError?.(e.message || 'Unable to open file')
  }
}

// ───────────────────────────── 1 · subject-wise progress ─────────────────────────────

const PAPER_STATUS = {
  completed:     { label: 'Finished',          tone: 'emerald' },
  'in-progress': { label: 'In progress',       tone: 'amber' },
  'not-started': { label: 'No class held yet', tone: 'gray' },
}
const NO_CLASSES = { booked: 0, held: 0, attended: 0, missed: 0, live: 0, upcoming: 0, nextClassAt: null }

// The server puts every topic on a ladder (not-allotted → allotted → attended →
// completed). Admins read that as jargon, so each topic is shown as ONE plain
// state instead — and every count, chip and badge on this section uses these
// same states, so the numbers always agree with each other.
const TOPIC_STATES = [
  { key: 'done',      label: 'Done',               tone: 'emerald', help: 'Mentor finished the topic and the student attended enough of it' },
  { key: 'attending', label: 'Attended, not done', tone: 'amber',   help: 'Student came to class, but the topic is not finished for them yet' },
  { key: 'missed',    label: 'Never attended',     tone: 'rose',    help: 'Classes were given for this topic but none of them were attended' },
  { key: 'upcoming',  label: 'Class booked',       tone: 'indigo',  help: 'The next class for this topic is scheduled or running now' },
  { key: 'no-class',  label: 'No class yet',       tone: 'gray',    help: 'No class has been given or booked for this topic yet' },
]
const STATE_META = Object.fromEntries(TOPIC_STATES.map(s => [s.key, s]))

function topicState(row) {
  if (row.completed) return 'done'
  if (row.status === 'attended') return 'attending'
  if (row.status === 'allotted') return row.pendingKind === 'upcoming' || row.pendingKind === 'live' ? 'upcoming' : 'missed'
  return 'no-class'
}

function countStates(rows) {
  const counts = Object.fromEntries(TOPIC_STATES.map(s => [s.key, 0]))
  for (const r of rows) counts[topicState(r)] += 1
  return counts
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : (word.endsWith('s') ? 'es' : 's')}`

// One plain sentence saying where this topic stands for the student and why.
function describeTopic(row, threshold) {
  const n = row.sessions || 0
  const came = row.attendedSessions || 0
  const bar = threshold != null ? `${threshold}%` : 'enough'
  const by = row.markedByName || 'admin'
  const next = row.nextClassAt ? `next class ${fmtDay(row.nextClassAt)}, ${fmtTime(row.nextClassAt)}` : ''

  switch (topicState(row)) {
    case 'done':
      if (row.source === 'manual' || (!n && row.manualMark === 'completed')) return { text: `Marked done by ${by}` }
      if (row.source === 'chapter') return { text: 'Covered in a full-chapter class' }
      return { text: `Came to ${came} of ${plural(n, 'class')} · in class ${row.percent}% of the time` }

    case 'attending': {
      const base = `Came to ${came} of ${plural(n, 'class')} · in class ${row.percent}% of the time`
      if (row.reason === 'teaching') return { text: base, why: 'mentor has not finished teaching this topic yet', cls: 'text-amber-600' }
      return { text: base, why: `needs ${bar} to count as done`, cls: 'text-rose-500' }
    }

    case 'upcoming':
      if (row.pendingKind === 'live') {
        return row.joinedLive
          ? { text: 'Class is live now', why: 'student is in it', cls: 'text-emerald-600' }
          : { text: 'Class is live now', why: 'student has not joined', cls: 'text-rose-500' }
      }
      return { text: n ? `Missed ${plural(n, 'earlier class')}` : 'Class booked', why: next, cls: 'text-indigo-600' }

    case 'missed': {
      if (!n && row.manualMark === 'absent') return { text: `Marked absent by ${by}` }
      const missed = n || row.missedSessions || 0
      const text = missed === 1 ? 'Did not attend the class' : missed ? `Did not attend any of the ${missed} classes` : 'Did not attend'
      // Joined but left too early to be counted present.
      const why = row.percent > 0 ? `was in class only ${row.percent}% of the time (needs ${bar})` : ''
      return { text, why, cls: 'text-rose-500' }
    }

    default:
      return { text: 'No class given or booked for this student yet' }
  }
}

// The admin's hand-set mark on a topic, for work done before the LMS ran the
// class: ✓ completed or ✗ absent, click again to clear. Same store the Chapter
// Progress grid writes to.
function MarkButton({ active, tone, busy, onClick, children }) {
  const on  = tone === 'emerald' ? 'bg-emerald-600 text-white' : 'bg-rose-500 text-white'
  const off = tone === 'emerald'
    ? 'bg-white text-emerald-600 border border-emerald-200 hover:bg-emerald-50'
    : 'bg-white text-rose-500 border border-rose-200 hover:bg-rose-50'
  return (
    <button type="button" onClick={onClick} disabled={busy}
      title={active ? 'Click to clear this hand-set mark' : tone === 'emerald' ? 'Mark done by hand' : 'Mark absent by hand'}
      className={`w-7 h-7 rounded-md text-xs font-bold transition-colors disabled:opacity-50 ${active ? on : off}`}>
      {children}
    </button>
  )
}

function ItemRow({ row, canMark, onMark, busy, threshold }) {
  const state = STATE_META[topicState(row)]
  const live = row.pendingKind === 'live' && !row.completed
  const line = describeTopic(row, threshold)
  const mark = row.manualMark || null
  // With the ✓/✗ buttons hidden, the ✎ is what says a person set this by hand.
  const handSet = row.source === 'manual' || !!mark
  return (
    <div className="flex items-center gap-3 px-3 py-2 bg-gray-50 rounded-lg">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-900 truncate">{row.unitName || row.chapterName}</p>
        <p className="text-[11px] text-gray-500 mt-0.5">
          {line.text}
          {line.why && <span className={line.cls}> — {line.why}</span>}
        </p>
      </div>
      {canMark && onMark && (
        <div className="flex items-center gap-1 flex-shrink-0">
          <MarkButton active={mark === 'completed'} tone="emerald" busy={busy}
            onClick={() => onMark(row, mark === 'completed' ? null : 'completed')}>✓</MarkButton>
          <MarkButton active={mark === 'absent'} tone="rose" busy={busy}
            onClick={() => onMark(row, mark === 'absent' ? null : 'absent')}>✗</MarkButton>
        </div>
      )}
      <div className="w-32 flex justify-end flex-shrink-0">
        <Badge tone={live ? 'rose' : state.tone}
          title={handSet ? `Set by hand by ${row.markedByName || 'admin'}` : state.help}>
          {live ? 'Live now' : state.label}{handSet && <span className="ml-0.5 opacity-60">✎</span>}
        </Badge>
      </div>
    </div>
  )
}

// "3 missed · 2 class booked · 7 no class yet" — the not-done states only, in
// the same words and colours as the filter chips.
function StateSummary({ counts }) {
  const parts = TOPIC_STATES.filter(s => s.key !== 'done' && counts[s.key] > 0)
  if (!parts.length) return null
  return parts.map(s => (
    <span key={s.key} className={TEXT_TONES[s.tone] || 'text-gray-400'}> · {counts[s.key]} {s.label.toLowerCase()}</span>
  ))
}

function SubjectCard({ subject, query, rowFilter = 'all', defaultOpen, forceOpen, onMark, busyKey, threshold }) {
  const [open, setOpen] = useState(defaultOpen)
  // Hand-set marks go on units where a chapter has them (the grain classes
  // are booked at); a chapter-level row of such a chapter can't take one.
  const unitChapters = new Set(subject.chapters.filter(c => c.rows.some(r => r.unitId)).map(c => c.chapterId))

  const q = query.trim().toLowerCase()
  // A live search or a status filter forces every card open — collapsed
  // matches would look like no match at all.
  const expanded = (q || rowFilter !== 'all' || forceOpen) ? true : open
  // Search narrows by name (a matching chapter keeps every topic); the status
  // chips then narrow by state. A chapter with nothing left disappears.
  const chapters = subject.chapters
    .map(ch => {
      const rows = (q && !ch.name.toLowerCase().includes(q))
        ? ch.rows.filter(r => (r.unitName || '').toLowerCase().includes(q))
        : ch.rows
      return { ...ch, rows: rows.filter(r => rowFilter === 'all' || topicState(r) === rowFilter) }
    })
    .filter(ch => ch.rows.length)

  const tone = subject.status === 'completed' ? 'emerald' : toneFor(subject.percent)
  const left = subject.totalItems - subject.completedItems
  const counts = countStates(subject.chapters.flatMap(c => c.rows))

  return (
    <div className="border border-gray-100 rounded-xl overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors">
        <span className="text-gray-300 text-xs w-3 flex-shrink-0">{expanded ? '▾' : '▸'}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-gray-900 truncate">{subject.name}</p>
            {subject.status === 'completed' && <Badge tone="emerald">Finished</Badge>}
            {subject.status === 'not-started' && <Badge tone="gray">No class held yet</Badge>}
          </div>
          <div className="flex items-center gap-3 mt-1.5">
            <Bar percent={subject.percent} tone={tone} className="flex-1 max-w-[220px]" />
            <span className={`text-xs font-semibold ${TEXT_TONES[tone]}`}>{subject.percent}%</span>
            <span className="text-[11px] text-gray-500 truncate">
              {subject.completedItems} of {subject.totalItems} topics done
              <span className="text-gray-400"> ({subject.completedChapters} of {subject.totalChapters} chapters)</span>
              <StateSummary counts={counts} />
            </span>
          </div>
        </div>
        {left > 0 && <span className="text-[11px] text-gray-400 flex-shrink-0">{left} topic{left !== 1 ? 's' : ''} left</span>}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {!chapters.length ? (
            <p className="text-xs text-gray-400 py-2">
              {subject.chapters.length
                ? `Nothing matches the current filter in ${subject.name}.`
                : 'No chapters have been added to this subject yet.'}
            </p>
          ) : chapters.map(ch => {
            // A chapter with no units is a single row that already carries its
            // own name and badge — repeating them as a heading would be noise.
            const single = ch.rows.length === 1 && !ch.rows[0].unitName
            return (
              <div key={ch.chapterId}>
                {!single && (
                  <div className="flex items-center gap-2 mb-1.5 pl-1">
                    <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide truncate">{ch.name}</p>
                    {ch.completed && <Badge tone="emerald">Chapter done</Badge>}
                    <Bar percent={ch.percent} tone={ch.completed ? 'emerald' : toneFor(ch.percent)} className="flex-1 max-w-[120px]" />
                    <span className="text-[10px] text-gray-400 flex-shrink-0">
                      {ch.completed ? 'all' : ch.done} of {ch.total} topics done
                    </span>
                  </div>
                )}
                <div className="space-y-1.5">
                  {ch.rows.map(r => (
                    <ItemRow key={`${r.chapterId}:${r.unitId || ''}`} row={r} onMark={onMark} threshold={threshold}
                      canMark={!!r.unitId || !unitChapters.has(ch.chapterId)}
                      busy={!!busyKey} />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function SyllabusSection({ syllabus, classes, thresholdPercent, onMark, busyKey }) {
  // '' = every paper, else one paper's id. Every number in the section —
  // syllabus, classes and the topic chips — follows the picked paper.
  const [paperId, setPaperId] = useState('')
  const [rowFilter, setRowFilter] = useState('all')
  const [query, setQuery] = useState('')
  // The ✓/✗ hand-set marks are a correction tool, not something to read past
  // on every visit — hidden until the admin asks to edit.
  const [editing, setEditing] = useState(false)

  // A paper that drops out of the report (scope changed, refresh) falls back
  // to all papers rather than leaving an empty, unexplained section.
  const paper = paperId ? syllabus.subjects.find(s => s.subjectId === paperId) || null : null
  const papers = useMemo(() => (paper ? [paper] : syllabus.subjects), [paper, syllabus])

  const stateCounts = useMemo(() => countStates(papers.flatMap(s => s.chapters.flatMap(c => c.rows))), [papers])
  const totals = paper ? {
    completedItems: paper.completedItems, totalItems: paper.totalItems,
    completedChapters: paper.completedChapters, totalChapters: paper.totalChapters,
  } : syllabus
  // Per-paper class counts come from the server (a class that taught two
  // papers counts under each); a paper with no class at all has no entry.
  const classTotals = !classes ? null
    : paper ? (classes.bySubject?.[paper.subjectId] || NO_CLASSES)
    : classes

  const q = query.trim().toLowerCase()
  const visible = papers.filter(s =>
    (rowFilter === 'all' || s.chapters.some(ch => ch.rows.some(r => topicState(r) === rowFilter))) &&
    (!q || s.name.toLowerCase().includes(q) ||
      s.chapters.some(ch => ch.name.toLowerCase().includes(q) || ch.rows.some(r => (r.unitName || '').toLowerCase().includes(q)))))


  return (
    <Section id="subjects" index={1} title="Subject-wise progress"
      subtitle={`Every topic this student has to cover. A topic is Done when the mentor has finished teaching it and the student attended ${
        thresholdPercent != null ? `at least ${thresholdPercent}%` : 'enough'} of its class time.`}>
      {paper && (
        <div className="flex items-center gap-2 px-5 py-2 bg-indigo-50 border-b border-indigo-100 text-xs text-indigo-700">
          Showing <b>{paper.name}</b> only
          <button type="button" onClick={() => setPaperId('')} className="ml-1 font-semibold underline hover:text-indigo-900">
            Show all papers
          </button>
        </div>
      )}
      <Tallies title="Syllabus" items={[
        { label: 'Topics done',   value: `${totals.completedItems} of ${totals.totalItems}`,         tone: 'emerald' },
        { label: 'Chapters done', value: `${totals.completedChapters} of ${totals.totalChapters}`,   tone: 'emerald' },
        paper
          ? { label: 'Paper', value: PAPER_STATUS[paper.status]?.label || '—', tone: PAPER_STATUS[paper.status]?.tone }
          : { label: 'Papers done', value: `${syllabus.completedSubjects} of ${syllabus.totalSubjects}`, tone: 'emerald' },
        { label: 'Topics left',   value: totals.totalItems - totals.completedItems,                  tone: 'amber' },
      ]} />
      {/* Counted once per class — a class that covers two chapters is one class. */}
      {classTotals && (
        <Tallies title="Classes" items={[
          { label: 'Booked',     value: classTotals.booked, hint: 'Every class this student was put in or joined, held or still to come' },
          { label: 'Held so far', value: classTotals.held,  hint: 'Classes that have already happened' },
          { label: 'Attended',   value: classTotals.attended, tone: 'emerald',
            hint: `Present — in class ${thresholdPercent != null ? `at least ${thresholdPercent}%` : 'enough'} of the time` },
          { label: 'Missed',     value: classTotals.missed, tone: classTotals.missed ? 'rose' : 'gray',
            hint: 'Held, but the student was absent or left too early' },
          ...(classTotals.live ? [{ label: 'Live now', value: classTotals.live, tone: 'rose' }] : []),
          { label: 'Upcoming',   value: classTotals.upcoming, tone: 'indigo',
            hint: classTotals.nextClassAt ? `Next class ${fmtDay(classTotals.nextClassAt)}, ${fmtTime(classTotals.nextClassAt)}` : 'Nothing scheduled' },
        ]} />
      )}

      {/* One filter row: where each topic stands. Counts are topics, the same
          numbers the subject cards show. */}
      <div className="flex items-center gap-1 px-5 py-3 border-b border-gray-100 flex-wrap">
        <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mr-1">Show topics</span>
        <Chip active={rowFilter === 'all'} onClick={() => setRowFilter('all')}>All {totals.totalItems}</Chip>
        {TOPIC_STATES.map(s => (
          <span key={s.key} title={s.help}>
            <Chip active={rowFilter === s.key} onClick={() => setRowFilter(s.key)} tone={s.tone}>
              {s.label} {stateCounts[s.key]}
            </Chip>
          </span>
        ))}
        <div className="flex items-center gap-2 ml-auto">
          <select value={paper ? paperId : ''} onChange={e => setPaperId(e.target.value)} className={`${inputCls} max-w-[220px]`}>
            <option value="">All papers ({syllabus.subjects.length})</option>
            {syllabus.subjects.map(s => (
              <option key={s.subjectId} value={s.subjectId}>{s.name} — {s.completedItems}/{s.totalItems} done</option>
            ))}
          </select>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search subject, chapter or topic…"
            className={`${inputCls} w-56`} />
          {onMark && (
            <button type="button" onClick={() => setEditing(e => !e)} disabled={!!busyKey}
              className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap disabled:opacity-50 ${
                editing ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
              {editing ? 'Done' : 'Edit marks'}
            </button>
          )}
        </div>
      </div>

      {editing && (
        <p className="px-5 py-2 text-[11px] text-indigo-700 bg-indigo-50 border-b border-indigo-100">
          Correcting by hand: ✓ marks a topic done, ✗ marks the student absent. Click the same button again to remove the mark.
          Use this only for classes taken outside the LMS.
        </p>
      )}

      <div className="p-4 space-y-2">
        {!syllabus.subjects.length ? (
          <Empty title="Nothing to show yet"
            hint="This student has no enrolled level and hasn't attended or been booked into a class tied to a chapter." />
        ) : !visible.length ? (
          <Empty title="No match" hint="Nothing here matches the current filter." />
        ) : visible.map(s => (
          <SubjectCard key={s.subjectId} subject={s} query={query} rowFilter={rowFilter} defaultOpen={visible.length <= 3} forceOpen={!!paper}
            onMark={editing ? onMark : null} busyKey={busyKey} threshold={thresholdPercent} />
        ))}
      </div>
    </Section>
  )
}

// ───────────────────────────── 2 · attendance log ─────────────────────────────

const ATT_STATUS = [
  { key: '',        label: 'All',     tone: 'indigo' },
  { key: 'present', label: 'Present', tone: 'emerald' },
  { key: 'late',    label: 'Late',    tone: 'amber' },
  { key: 'absent',  label: 'Absent',  tone: 'rose' },
]

const ATT_BADGE = {
  present: { tone: 'emerald', label: 'Present' },
  late:    { tone: 'amber',   label: 'Late' },
  absent:  { tone: 'rose',    label: 'Absent' },
}

function AttendanceSection({ studentId }) {
  const [filters, setFilters] = useState({ page: 1, limit: 20, status: '', subjectId: '', dateFrom: '', dateTo: '' })
  const set = (patch) => setFilters(f => ({ ...f, page: 1, ...patch }))
  const { data, error, loading } = useResource(`/api/admin/users/${studentId}/attendance-log`, filters)

  const rows = data?.rows || []
  const s = data?.summary
  const lateMins = Math.round((data?.lateAfterMs || 0) / 60000)

  return (
    <Section id="attendance" index={2} title="Attendance log"
      subtitle={`One row per class this student was on the roster for.${lateMins ? ` Present but joining more than ${lateMins} min late is flagged Late.` : ''}`}>
      {s && (
        <Tallies items={[
          { label: 'Classes',   value: s.sessions },
          { label: 'Present',   value: s.present, tone: 'emerald' },
          { label: 'Late',      value: s.late,    tone: 'amber' },
          { label: 'Absent',    value: s.absent,  tone: 'rose' },
          { label: 'Time attended', value: `${fmtMs(s.attendedMs)} / ${fmtMs(s.durationMs)}` },
          { label: 'Attendance',    value: `${s.percent}%`, tone: toneFor(s.percent) },
        ]} />
      )}

      <LogFilters
        subjects={data?.subjects || []} status={filters.status}
        subjectId={filters.subjectId} onSubject={v => set({ subjectId: v })}
        dateFrom={filters.dateFrom} dateTo={filters.dateTo}
        onDate={(which, v) => set(which === 'from' ? { dateFrom: v } : { dateTo: v })}
        onReset={() => set({ subjectId: '', dateFrom: '', dateTo: '', status: '' })}>
        <div className="flex gap-1">
          {ATT_STATUS.map(o => (
            <Chip key={o.key} active={filters.status === o.key} onClick={() => set({ status: o.key })} tone={o.tone}>{o.label}</Chip>
          ))}
        </div>
      </LogFilters>

      {error ? <Empty title="Couldn't load the attendance log" hint={error} /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[860px]">
            <thead>
              <tr className="border-b border-gray-100 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
                <th className="text-left px-5 py-3">Date</th>
                <th className="text-left px-5 py-3">Class</th>
                <th className="text-left px-5 py-3">Topic</th>
                <th className="text-left px-5 py-3">Tutor</th>
                <th className="text-left px-5 py-3">Attended</th>
                <th className="text-left px-5 py-3">Status</th>
              </tr>
            </thead>
            {loading ? <TableSkeleton cols={6} /> : (
              <tbody>
                {!rows.length ? (
                  <tr><td colSpan={6} className="px-5 py-12">
                    <Empty title="No classes here" hint="Nothing matches the current filter." />
                  </td></tr>
                ) : rows.map(r => {
                  const badge = ATT_BADGE[r.status] || ATT_BADGE.absent
                  return (
                    <tr key={r._id} className="border-b border-gray-50 hover:bg-gray-50/60 align-top">
                      <td className="px-5 py-3 whitespace-nowrap">
                        <p className="text-gray-900">{fmtDay(r.classDate)}</p>
                        <p className="text-[11px] text-gray-400">{fmtTime(r.classDate)}</p>
                      </td>
                      <td className="px-5 py-3 max-w-[220px]">
                        <p className="text-gray-900 truncate" title={r.title}>{r.title}</p>
                        <p className="text-[11px] text-gray-400 truncate">
                          {[r.roomLabel, r.trackLabel].filter(Boolean).join(' · ') || '—'}
                          {r.classStatus === 'deleted' && <span className="text-rose-500"> · class deleted</span>}
                        </p>
                      </td>
                      <td className="px-5 py-3 max-w-[240px]">
                        <p className="text-gray-700 truncate" title={r.subject?.name}>{r.subject?.name || '—'}</p>
                        <p className="text-[11px] text-gray-400 truncate">
                          {logTopics(r) || '—'}
                        </p>
                      </td>
                      <td className="px-5 py-3 text-gray-600 whitespace-nowrap">{r.tutor || '—'}</td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        <p className={`font-semibold ${TEXT_TONES[toneFor(r.percent)]}`}>{r.percent}%</p>
                        <p className="text-[11px] text-gray-400">
                          {fmtMs(r.attendedMs)} of {fmtMs(r.classDurationMs)}
                          {r.firstJoinAt && ` · joined ${fmtTime(r.firstJoinAt)}`}
                        </p>
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        <Badge tone={badge.tone}
                          title={r.presentSource === 'manual' ? `Marked by ${r.markedByName || 'mentor'}` : `Auto-computed · needs ≥${r.requiredPercent}%`}>
                          {badge.label}{r.presentSource === 'manual' && <span className="ml-0.5 opacity-60">✎</span>}
                        </Badge>
                        {r.chapterCompleted && <p className="text-[10px] text-emerald-600 mt-1">chapter cleared</p>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            )}
          </table>
        </div>
      )}

      <Pager page={filters.page} totalPages={data?.pagination?.totalPages || 1} total={data?.pagination?.total || 0}
        unit="classes" onPage={p => setFilters(f => ({ ...f, page: p }))} />
    </Section>
  )
}

// ───────────────────────────── 3 · test marks ─────────────────────────────

const TEST_STATUS = [
  { key: '',          label: 'All',       tone: 'indigo' },
  { key: 'completed', label: 'Evaluated', tone: 'emerald' },
  { key: 'assigned',  label: 'Assigned',  tone: 'blue' },
  { key: 'pending',   label: 'Pending',   tone: 'amber' },
]

const TEST_BADGE = {
  completed: { tone: 'emerald', label: 'Evaluated' },
  assigned:  { tone: 'blue',    label: 'Assigned' },
  pending:   { tone: 'amber',   label: 'Pending' },
}

function FileLinks({ submissionId, files, label, tone, onError }) {
  if (!files?.length) return null
  const base = `/api/admin/test-submissions/${submissionId}/file`
  return (
    <div className="space-y-1">
      {files.map(f => (
        <div key={f.key} className="flex items-center gap-1.5">
          <button onClick={() => openInTab(`${base}?key=${encodeURIComponent(f.key)}&inline=1`, onError)}
            title={f.name}
            className={`text-[11px] font-semibold px-2 py-1 rounded-md ${SOFT_TONES[tone]} hover:opacity-80 whitespace-nowrap`}>
            {label}
          </button>
          <button onClick={() => openInTab(`${base}?key=${encodeURIComponent(f.key)}`, onError)}
            className="text-[11px] text-gray-400 hover:text-gray-700" title={`Download ${f.name}`}>↓</button>
        </div>
      ))}
    </div>
  )
}

const TEST_TYPE_LABEL = { chapter_wise: 'Chapter-wise', segment_wise: 'Segment-wise', full_test: 'Full test' }

// What each paper type is, in one line a new admin can follow.
const TYPE_INFO = {
  chapter_wise: { title: 'Chapter-wise tests', blurb: 'One chapter per test',          edge: 'border-t-indigo-500', text: 'text-indigo-700' },
  segment_wise: { title: 'Segment-wise tests', blurb: 'A group of chapters per test',  edge: 'border-t-violet-500', text: 'text-violet-700' },
  full_test:    { title: 'Full tests',         blurb: 'The whole subject in one test', edge: 'border-t-sky-500',    text: 'text-sky-700' },
}

const pctOf = (n, d) => (d > 0 ? Math.min(100, Math.round((n / d) * 100)) : 0)
const fmtMarks = (n) => (Number.isInteger(n) ? n : Number(n.toFixed(1)))

// Paper sizes that actually exist (a 0-mark paper is a data slip, not a size).
const sizesOf = (marks) => marks.filter(m => m.marks > 0 && (m.papers || m.written))

const SCORE_HINT = 'Marks scored ÷ marks possible, over the papers a mentor has checked'

// The page's one visual language for tests: a bar split into checked (green),
// waiting for a mentor (amber) and not written yet (grey track).
function StackBar({ checked, waiting, of, className = 'h-2' }) {
  const c = pctOf(checked, of)
  const w = Math.min(100 - c, pctOf(waiting, of))
  return (
    <div className={`flex bg-gray-100 rounded-full overflow-hidden ${className}`}
      title={`${checked} checked · ${waiting} waiting · ${Math.max(0, of - checked - waiting)} not written`}>
      {c > 0 && <div className="bg-emerald-500 h-full" style={{ width: `${c}%` }} />}
      {w > 0 && <div className="bg-amber-400 h-full" style={{ width: `${w}%` }} />}
    </div>
  )
}

function Dot({ tone }) {
  const bg = { emerald: 'bg-emerald-500', amber: 'bg-amber-400', gray: 'bg-gray-200' }[tone]
  return <span className={`inline-block w-2 h-2 rounded-full ${bg}`} />
}

// "55%" in a soft pill coloured by how good it is.
function ScorePill({ percent, size = 'sm' }) {
  if (percent == null) return null
  const pad = size === 'lg' ? 'text-sm px-2.5 py-1' : 'text-[11px] px-1.5 py-0.5'
  return (
    <span title={SCORE_HINT} className={`inline-flex items-center rounded-md font-bold ${pad} ${SOFT_TONES[toneFor(percent)]}`}>
      {percent}%
    </span>
  )
}

function SizeChips({ marks }) {
  const sizes = sizesOf(marks)
  if (!sizes.length) return null
  return (
    <div className="flex flex-wrap gap-1">
      {sizes.map(m => (
        <span key={m.marks} className="text-[11px] bg-gray-50 border border-gray-100 rounded-md px-1.5 py-0.5 text-gray-500">
          {m.marks} marks · <b className="text-gray-800">{m.written}</b>/{m.papers}
        </span>
      ))}
    </div>
  )
}

// Big picture for the whole section: written so far, where those papers stand,
// and the score — one glance before any table.
function CoverageOverview({ grand, grandPercent }) {
  const left = Math.max(0, grand.canWrite - grand.written)
  return (
    <div className="rounded-2xl bg-gradient-to-br from-indigo-50 via-white to-white border border-indigo-100 px-5 py-4 grid gap-5 md:grid-cols-[1fr_auto] items-center">
      <div className="min-w-0">
        <p className="text-[11px] font-semibold text-indigo-500 uppercase tracking-wide">Tests written</p>
        <p className="mt-1 text-gray-900 leading-none">
          <span className="text-4xl font-bold">{grand.written}</span>
          <span className="text-lg text-gray-400 font-medium"> / {grand.canWrite}</span>
          <span className="ml-2 text-sm text-gray-500">({pctOf(grand.written, grand.canWrite)}% of available tests)</span>
        </p>
        <StackBar checked={grand.evaluated} waiting={grand.awaiting} of={grand.canWrite} className="h-3 mt-3" />
        <div className="flex items-center gap-4 mt-2 text-xs text-gray-600 flex-wrap">
          <span className="flex items-center gap-1.5"><Dot tone="emerald" /><b>{grand.evaluated}</b> checked</span>
          <span className="flex items-center gap-1.5"><Dot tone="amber" /><b>{grand.awaiting}</b> waiting for mentor</span>
          <span className="flex items-center gap-1.5"><Dot tone="gray" /><b>{left}</b> not written yet</span>
        </div>
      </div>
      <div className="md:text-right md:border-l md:border-indigo-100 md:pl-6">
        <p className="text-[11px] font-semibold text-indigo-500 uppercase tracking-wide">Average score</p>
        {grandPercent != null ? (
          <>
            <p className={`text-4xl font-bold mt-1 leading-none ${TEXT_TONES[toneFor(grandPercent)]}`} title={SCORE_HINT}>{grandPercent}%</p>
            <p className="text-xs text-gray-500 mt-2">{fmtMarks(grand.awarded)} of {fmtMarks(grand.total)} marks</p>
          </>
        ) : (
          <>
            <p className="text-4xl font-bold mt-1 leading-none text-gray-300">—</p>
            <p className="text-xs text-gray-400 mt-2">No checked papers yet</p>
          </>
        )}
      </div>
    </div>
  )
}

// One card per paper type: count, the same split bar, score, paper sizes.
function TypeCard({ t }) {
  const info = TYPE_INFO[t.key]
  const inPlan = t.canWrite > 0 || t.written > 0
  return (
    <div className={`rounded-xl border border-gray-200 border-t-4 ${info.edge} bg-white px-4 py-4 min-w-0 flex flex-col gap-3`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className={`text-sm font-bold ${info.text}`}>{info.title}</p>
          <p className="text-[11px] text-gray-400 mt-0.5">{info.blurb}</p>
        </div>
        <ScorePill percent={t.percent} size="lg" />
      </div>

      {!inPlan ? (
        <p className="text-sm text-gray-400 py-4">Not in this student's plan</p>
      ) : (
        <>
          <p className="text-gray-900 leading-none">
            <span className="text-3xl font-bold">{t.written}</span>
            <span className="text-sm text-gray-400"> / {t.canWrite} written</span>
          </p>
          <StackBar checked={t.evaluated} waiting={t.awaiting} of={t.canWrite} />
          <div className="flex items-center gap-3 text-[11px] text-gray-600 flex-wrap">
            <span className="flex items-center gap-1"><Dot tone="emerald" />{t.evaluated} checked</span>
            <span className="flex items-center gap-1"><Dot tone="amber" />{t.awaiting} waiting</span>
            <span className="flex items-center gap-1"><Dot tone="gray" />{t.left} left</span>
          </div>
          {t.opened > 0 && <p className="text-[11px] text-amber-600 -mt-1">{t.opened} started but not submitted</p>}
          <div className="mt-auto pt-3 border-t border-gray-100">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Paper sizes · written / available</p>
            <SizeChips marks={t.marks} />
          </div>
        </>
      )}
    </div>
  )
}

// One subject × type cell. Quiet when nothing's been written; clickable (it
// narrows the submission list below) once there is something to look at.
function CoverageCell({ c, showSizes, onOpen }) {
  if (!c.canWrite && !c.written && !c.opened) {
    return <td className="px-4 py-3.5 text-xs text-gray-300" title="No papers of this type in the student's plan">—</td>
  }
  const active = c.written > 0
  const allDone = c.canWrite > 0 && c.written >= c.canWrite
  const body = (
    <>
      <div className="flex items-center gap-2">
        <span className={active ? 'text-gray-900' : 'text-gray-400'}>
          <b className="text-[15px]">{c.written}</b><span className="text-xs"> / {c.canWrite}</span>
        </span>
        {allDone && <span className="text-[10px] font-bold text-emerald-600">✓ ALL</span>}
        <ScorePill percent={c.percent} />
        {c.awaiting > 0 && (
          <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 rounded px-1.5 py-0.5">{c.awaiting} waiting</span>
        )}
        {active && <span className="ml-auto text-[11px] font-semibold text-indigo-600 opacity-0 group-hover:opacity-100 transition">View →</span>}
      </div>
      <StackBar checked={c.evaluated} waiting={c.awaiting} of={c.canWrite} className="h-1.5 mt-1.5 w-32" />
      {c.opened > 0 && <p className="text-[11px] text-amber-600 mt-1">{c.opened} started, not submitted</p>}
      {c.allowance != null && (
        <p className="text-[11px] text-gray-400 mt-1" title={`The plan lets this student pick any ${c.allowance} of the ${c.papers} papers`}>
          Plan: any {c.allowance} of {c.papers}
        </p>
      )}
      {showSizes && <div className="mt-1.5"><SizeChips marks={c.marks} /></div>}
    </>
  )
  return (
    <td className="px-2 py-2 align-top">
      {active ? (
        <button type="button" onClick={onOpen} title="Show these papers in the submission list below"
          className="group w-full text-left rounded-lg px-2 py-1.5 hover:bg-indigo-50 hover:ring-1 hover:ring-indigo-100 transition">
          {body}
        </button>
      ) : (
        <div className="px-2 py-1.5">{body}</div>
      )}
    </td>
  )
}

// Column totals over the subjects on screen, so the cards and the Total row
// always add up to the rows the admin can see (enrolled only, or all).
function totalsFor(typeMeta, rows) {
  return typeMeta.map(meta => {
    const t = { ...meta, papers: 0, canWrite: 0, written: 0, evaluated: 0, awaiting: 0, opened: 0, left: 0, awarded: 0, total: 0 }
    const marks = new Map()
    for (const r of rows) {
      const c = r.types[meta.key]
      for (const k of ['papers', 'canWrite', 'written', 'evaluated', 'awaiting', 'opened', 'left', 'awarded', 'total']) t[k] += c[k]
      for (const m of c.marks) {
        const x = marks.get(m.marks) || { marks: m.marks, papers: 0, written: 0 }
        x.papers += m.papers
        x.written += m.written
        marks.set(m.marks, x)
      }
    }
    t.percent = t.evaluated ? pctOf(t.awarded, t.total) : null
    t.marks = [...marks.values()].sort((a, b) => a.marks - b.marks)
    return t
  })
}

// A small help pop-up that behaves like a menu: opens on click, closes on a
// click anywhere outside it, on Esc, or on the button again.
function HelpPopover({ label, children }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div ref={ref} className="relative text-xs">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="font-semibold text-indigo-600 hover:text-indigo-800 select-none">
        {label}
      </button>
      {open && (
        <div role="dialog"
          className="absolute right-0 z-30 mt-2 w-80 max-w-[calc(100vw-2rem)] bg-white border border-gray-200 rounded-xl shadow-lg p-4 pr-9 space-y-2 text-gray-600 leading-relaxed">
          <button type="button" onClick={() => setOpen(false)} aria-label="Close"
            className="absolute top-2 right-2 w-6 h-6 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100">✕</button>
          {children}
        </div>
      )}
    </div>
  )
}

const SCOPE_CHIP = {
  class:         { tone: 'indigo', hint: 'Class student — the top numbers count only the subjects they are enrolled for' },
  open:          { tone: 'gray',   hint: 'Not a class student (no class booked or bought), so every subject in their plan is counted' },
  'class-unset': { tone: 'amber',  hint: 'Set their level and group from Users → Course to narrow this to their subjects' },
}

// One "Total" line of the subject table.
function TotalRow({ label, types, grand, grandPercent, strong }) {
  return (
    <tr className={`text-xs text-gray-700 ${strong ? 'bg-gray-50 border-t border-gray-200' : 'bg-white border-t border-gray-100'}`}>
      <td className={`px-4 py-3 uppercase tracking-wide text-[11px] ${strong ? 'font-bold text-gray-600' : 'font-semibold text-gray-400'}`}>{label}</td>
      {types.map(t => (
        <td key={t.key} className="px-4 py-3">
          <span className="flex items-center gap-2"><span><b>{t.written}</b> / {t.canWrite}</span><ScorePill percent={t.percent} /></span>
        </td>
      ))}
      <td className="px-4 py-3">
        <span className="flex items-center gap-2"><span><b>{grand.written}</b> / {grand.canWrite}</span><ScorePill percent={grandPercent} /></span>
      </td>
    </tr>
  )
}

function grandOf(types) {
  const g = types.reduce((a, t) => ({
    written: a.written + t.written, canWrite: a.canWrite + t.canWrite, evaluated: a.evaluated + t.evaluated,
    awaiting: a.awaiting + t.awaiting, awarded: a.awarded + t.awarded, total: a.total + t.total,
  }), { written: 0, canWrite: 0, evaluated: 0, awaiting: 0, awarded: 0, total: 0 })
  return { grand: g, grandPercent: g.evaluated ? pctOf(g.awarded, g.total) : null }
}

// "How many tests could they write, and how many did they?" — per subject and
// per paper type. Available = the papers in the student's plan (the same list
// their own Test Series page shows, after any "any N per subject" cap).
//
// The top (overview + type cards) always counts ENROLLED subjects only. The
// subject table can additionally show the rest of the level on demand, with
// its own totals, so the headline numbers never change under the admin.
function TestCoverage({ studentId, onOpen }) {
  const { data, error, loading } = useResource(`/api/admin/users/${studentId}/test-coverage`, null)
  const [showSizes, setShowSizes] = useState(false)
  const [showAll, setShowAll] = useState(false)

  if (loading) {
    return (
      <div className="p-5 border-b border-gray-100 space-y-3">
        <div className="h-28 bg-gray-100 rounded-2xl animate-pulse" />
        <div className="grid gap-3 md:grid-cols-3">
          {[1, 2, 3].map(i => <div key={i} className="h-48 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
      </div>
    )
  }
  if (error) return <div className="border-b border-gray-100"><Empty title="Couldn't load test coverage" hint={error} /></div>
  if (!data) return null

  const hasAnything = data.subjects.some(s => s.summary.papers > 0 || s.summary.written > 0 || s.summary.opened > 0)
  if (!hasAnything) {
    return (
      <div className="border-b border-gray-100">
        <Empty title="No test series in this student's plan"
          hint="None of their products include test-series papers, and they haven't written any." />
      </div>
    )
  }

  const scope = data.scope || { mode: 'open', label: '' }
  const enrolled = data.subjects.filter(s => s.enrolled !== false)
  const outside = data.subjects.filter(s => s.enrolled === false)
  const outsideWritten = outside.filter(s => s.summary.written > 0)
  const outsideWrittenCount = outsideWritten.reduce((n, s) => n + s.summary.written, 0)

  const types = totalsFor(data.types, enrolled)
  const { grand, grandPercent } = grandOf(types)
  const allTypes = totalsFor(data.types, data.subjects)
  const all = grandOf(allTypes)

  const chip = SCOPE_CHIP[scope.mode] || SCOPE_CHIP.open
  const chipText = scope.mode === 'class' ? `Enrolled: ${scope.batch}`
    : scope.mode === 'open' ? 'Not a class student · all subjects' : 'Class student · no batch set · all subjects'
  const batchText = scope.batch
    ? `${scope.picked ? 'Papers' : 'Batch'}: ${scope.batch}`
    : 'Batch: not set'

  const revealOutside = () => {
    setShowAll(true)
    setTimeout(() => document.getElementById('coverage-table')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  return (
    <div className="border-b border-gray-100 p-5 space-y-4">
      {/* scope + help */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <p className="text-sm font-semibold text-gray-900">Tests available vs written</p>
          <Badge tone={chip.tone} title={chip.hint}>{chipText}</Badge>
        </div>
        <HelpPopover label="ⓘ How to read this">
          <p><b>Available</b> — test papers this student's plan lets them write.</p>
          <p><b>Written</b> — papers they submitted. Writing the same paper again counts once.</p>
          <p><Dot tone="emerald" /> <b>Checked</b> — a mentor corrected it and gave marks.</p>
          <p><Dot tone="amber" /> <b>Waiting</b> — submitted, not corrected yet.</p>
          <p><b>Score</b> — marks scored ÷ marks possible, over checked papers. A 50-mark paper counts double a 25-mark one.</p>
          {scope.mode === 'class' && <p><b>Enrolled only</b> — the numbers at the top count only the student's batch. Tick "Show not-enrolled subjects" in the table to see the rest.</p>}
          {data.limited && <p><b>Plan: any N</b> — the student picks which N papers to write in that subject.</p>}
          <p className="text-gray-400">Click any highlighted cell to see those papers in the list below.</p>
        </HelpPopover>
      </div>

      {outsideWrittenCount > 0 && (
        <div className="flex items-start gap-2.5 text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-xl px-3.5 py-2.5">
          <span className="text-base leading-none">⚠</span>
          <p className="flex-1">
            <b>{outsideWrittenCount} test{outsideWrittenCount === 1 ? '' : 's'}</b> written in subjects outside their batch
            ({outsideWritten.map(s => s.name).join(', ')}) are not counted in these numbers.
          </p>
          {!showAll && (
            <button type="button" onClick={revealOutside}
              className="font-semibold text-amber-900 bg-white border border-amber-200 rounded-lg px-2.5 py-1 hover:bg-amber-100 whitespace-nowrap">
              Show in table
            </button>
          )}
        </div>
      )}

      <CoverageOverview grand={grand} grandPercent={grandPercent} />

      <div className="grid gap-3 md:grid-cols-3">
        {types.map(t => <TypeCard key={t.key} t={t} />)}
      </div>

      {/* subject matrix */}
      <div id="coverage-table" className="rounded-xl border border-gray-200 overflow-hidden scroll-mt-4">
        <div className="px-4 py-3 bg-gray-50/80 border-b border-gray-200 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5 flex-wrap min-w-0">
            <p className="text-sm font-semibold text-gray-900">Subject by subject</p>
            <Badge tone={scope.batch ? 'indigo' : 'amber'}
              title={scope.batch ? 'What this student is enrolled for (Users → Course)' : 'No level, group or papers set for this student'}>
              {batchText}
            </Badge>
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            <div className="hidden lg:flex items-center gap-3 text-[11px] text-gray-500">
              <span className="flex items-center gap-1"><Dot tone="emerald" />Checked</span>
              <span className="flex items-center gap-1"><Dot tone="amber" />Waiting</span>
              <span className="flex items-center gap-1"><Dot tone="gray" />Not written</span>
            </div>
            {outside.length > 0 && (
              <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
                <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)}
                  className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-400" />
                Show not-enrolled subjects <span className="text-gray-400">(+{outside.length})</span>
              </label>
            )}
            <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
              <input type="checkbox" checked={showSizes} onChange={e => setShowSizes(e.target.checked)}
                className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-400" />
              Show paper sizes
            </label>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[860px]">
            <thead>
              <tr className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-100">
                <th className="text-left px-4 py-2.5 w-[24%]">Subject</th>
                {types.map(t => <th key={t.key} className="text-left px-4 py-2.5">{t.label}</th>)}
                <th className="text-left px-4 py-2.5">Overall</th>
              </tr>
            </thead>
            <tbody>
              {!enrolled.length && (
                <tr><td colSpan={types.length + 2} className="px-5 py-8">
                  <Empty title="No subjects in this student's batch"
                    hint='Tick "Show not-enrolled subjects" to see the other subjects.' />
                </td></tr>
              )}
              {enrolled.map(s => (
                <SubjectRow key={s.subjectId || s.name} s={s} types={types} showSizes={showSizes} onOpen={onOpen} />
              ))}
              {showAll && outside.length > 0 && (
                <>
                  <tr className="bg-gray-50 border-y border-gray-200">
                    <td colSpan={types.length + 2} className="px-4 py-2 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                      Not enrolled · {outside.length} subject{outside.length === 1 ? '' : 's'}
                      <span className="normal-case font-normal text-gray-400"> — not counted in the numbers at the top</span>
                    </td>
                  </tr>
                  {outside.map(s => (
                    <SubjectRow key={s.subjectId || s.name} s={s} types={types} showSizes={showSizes} onOpen={onOpen} muted />
                  ))}
                </>
              )}
            </tbody>
            <tfoot>
              <TotalRow strong label={scope.mode === 'class' ? 'Enrolled total' : 'Total'}
                types={types} grand={grand} grandPercent={grandPercent} />
              {showAll && outside.length > 0 && (
                <TotalRow label="All subjects total" types={allTypes} grand={all.grand} grandPercent={all.grandPercent} />
              )}
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  )
}

function SubjectRow({ s, types, showSizes, onOpen, muted }) {
  const done = pctOf(s.summary.written, s.summary.canWrite)
  const inPlan = s.summary.papers > 0 || s.summary.written > 0 || s.summary.opened > 0
  return (
    <tr className={`align-top border-b border-gray-100 last:border-0 ${muted ? 'bg-gray-50/40' : ''}`}>
      <td className="px-4 py-3.5">
        <p className={`font-medium truncate ${muted ? 'text-gray-500' : 'text-gray-900'}`} title={s.name}>{s.name}</p>
        {s.level && <p className="text-[11px] text-gray-400 mt-0.5">{s.level}</p>}
      </td>
      {types.map(t => (
        <CoverageCell key={t.key} c={s.types[t.key]} showSizes={showSizes}
          onOpen={() => onOpen({ subjectId: s.subjectId || '', testSeriesType: t.key })} />
      ))}
      <td className="px-4 py-3.5 whitespace-nowrap">
        {!inPlan ? (
          <span className="text-[11px] text-gray-400" title="None of this student's products include test papers for this subject">
            No test series in plan
          </span>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <span className={s.summary.written ? 'text-gray-900' : 'text-gray-400'}>
                <b>{s.summary.written}</b><span className="text-xs"> / {s.summary.canWrite}</span>
              </span>
              {s.summary.written > 0 && <span className="text-[11px] text-gray-400">{done}%</span>}
              <ScorePill percent={s.summary.percent} />
            </div>
            <StackBar checked={s.summary.evaluated} waiting={s.summary.awaiting} of={s.summary.canWrite} className="h-1.5 mt-1.5 w-28" />
          </>
        )}
      </td>
    </tr>
  )
}

function TestMarksSection({ studentId }) {
  const [filters, setFilters] = useState({ page: 1, limit: 20, status: '', subjectId: '', testSeriesType: '', dateFrom: '', dateTo: '' })
  const [fileError, setFileError] = useState('')
  const set = (patch) => setFilters(f => ({ ...f, page: 1, ...patch }))
  const { data, error, loading } = useResource(`/api/admin/users/${studentId}/test-marks`, filters)

  const rows = data?.rows || []
  const s = data?.summary

  // A coverage cell was clicked: show just those papers and bring the list into view.
  const openCell = (patch) => {
    set({ status: '', dateFrom: '', dateTo: '', ...patch })
    document.getElementById('test-log')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <Section id="tests" index={3} title="Test marks"
      subtitle="How many chapter-wise, segment-wise and full tests this student could write and has written, then every submission date-wise with its marks.">
      <TestCoverage studentId={studentId} onOpen={openCell} />

      <div id="test-log" className="scroll-mt-4 px-5 pt-4">
        <p className="text-xs font-semibold text-gray-700">Every submission</p>
      </div>

      {s && (
        <Tallies items={[
          { label: 'Submitted', value: s.submitted },
          { label: 'Evaluated', value: s.evaluated, tone: 'emerald' },
          { label: 'Awaiting review', value: s.pending, tone: 'amber' },
          { label: 'Marks', value: s.evaluated ? `${s.awarded}/${s.total}` : '—' },
          { label: 'Average', value: s.evaluated ? `${s.averagePercent}%` : '—', tone: s.evaluated ? toneFor(s.averagePercent) : 'gray' },
        ]} />
      )}

      <LogFilters
        subjects={data?.subjects || []} status={filters.status || filters.testSeriesType}
        subjectId={filters.subjectId} onSubject={v => set({ subjectId: v })}
        dateFrom={filters.dateFrom} dateTo={filters.dateTo}
        onDate={(which, v) => set(which === 'from' ? { dateFrom: v } : { dateTo: v })}
        onReset={() => set({ subjectId: '', testSeriesType: '', dateFrom: '', dateTo: '', status: '' })}>
        <div className="flex gap-1">
          {TEST_STATUS.map(o => (
            <Chip key={o.key} active={filters.status === o.key} onClick={() => set({ status: o.key })} tone={o.tone}>{o.label}</Chip>
          ))}
        </div>
        <select value={filters.testSeriesType} onChange={e => set({ testSeriesType: e.target.value })} className={inputCls}>
          <option value="">All test types</option>
          {Object.entries(TEST_TYPE_LABEL).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
      </LogFilters>

      {fileError && <p className="px-5 py-2 text-xs text-rose-600 bg-rose-50">{fileError}</p>}

      {error ? <Empty title="Couldn't load test marks" hint={error} /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="border-b border-gray-100 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
                <th className="text-left px-5 py-3">Test date</th>
                <th className="text-left px-5 py-3">Test</th>
                <th className="text-left px-5 py-3">Topic</th>
                <th className="text-left px-5 py-3">Marks</th>
                <th className="text-left px-5 py-3">Evaluated by</th>
                <th className="text-left px-5 py-3">Answer paper</th>
              </tr>
            </thead>
            {loading ? <TableSkeleton cols={6} /> : (
              <tbody>
                {!rows.length ? (
                  <tr><td colSpan={6} className="px-5 py-12">
                    <Empty title="No test submissions" hint="Nothing matches the current filter." />
                  </td></tr>
                ) : rows.map(r => {
                  const badge = TEST_BADGE[r.status] || TEST_BADGE.pending
                  return (
                    <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50/60 align-top">
                      <td className="px-5 py-3 whitespace-nowrap">
                        <p className="text-gray-900">{fmtDay(r.date)}</p>
                        <p className="text-[11px] text-gray-400">{fmtTime(r.date)}</p>
                      </td>
                      <td className="px-5 py-3 max-w-[240px]">
                        <p className="text-gray-900 truncate" title={r.fileName}>{r.fileName || 'Untitled test'}</p>
                        <p className="text-[11px] text-gray-400 truncate">
                          {[r.level, TEST_TYPE_LABEL[r.testSeriesType] || r.testSeriesType,
                            r.totalMarks ? `${r.totalMarks} marks` : null,
                            r.testDuration ? `${r.testDuration} min` : null].filter(Boolean).join(' · ') || '—'}
                        </p>
                      </td>
                      <td className="px-5 py-3 max-w-[220px]">
                        <p className="text-gray-700 truncate" title={r.subject}>{r.subject || '—'}</p>
                        <p className="text-[11px] text-gray-400 truncate">
                          {[r.chapter, r.unit].filter(Boolean).join(' · ') || '—'}
                        </p>
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        {r.status === 'completed' ? (
                          <>
                            <p className="font-semibold text-gray-900">
                              {r.awardedMarks ?? 0}<span className="text-gray-400 font-normal"> / {r.totalMarks || 0}</span>
                            </p>
                            {r.percent != null && (
                              <p className={`text-[11px] font-semibold ${TEXT_TONES[toneFor(r.percent)]}`}>{r.percent}%</p>
                            )}
                          </>
                        ) : (
                          <Badge tone={badge.tone}>{badge.label}</Badge>
                        )}
                      </td>
                      <td className="px-5 py-3 max-w-[160px]">
                        <p className="text-gray-600 truncate">{r.mentor?.name || (r.status === 'pending' ? 'Unassigned' : '—')}</p>
                        {r.evaluatedAt && <p className="text-[11px] text-gray-400">{fmtDay(r.evaluatedAt)}</p>}
                        {r.mentorNotes && (
                          <p className="text-[11px] text-gray-400 truncate" title={r.mentorNotes}>“{r.mentorNotes}”</p>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        {!r.answerFiles.length && !r.evaluatedFiles.length ? (
                          <span className="text-[11px] text-gray-300">
                            {r.status === 'completed' ? 'No file' : 'Not yet reviewed'}
                          </span>
                        ) : (
                          <div className="flex flex-col gap-1.5">
                            <FileLinks submissionId={r.id} files={r.answerFiles} label="Answer sheet" tone="blue" onError={setFileError} />
                            <FileLinks submissionId={r.id} files={r.evaluatedFiles} label="Corrected" tone="emerald" onError={setFileError} />
                            {r.reviewVideoUrl && (
                              <a href={r.reviewVideoUrl} target="_blank" rel="noreferrer"
                                className="text-[11px] font-semibold text-violet-600 hover:underline">Review video ↗</a>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            )}
          </table>
        </div>
      )}

      <Pager page={filters.page} totalPages={data?.pagination?.totalPages || 1} total={data?.pagination?.total || 0}
        unit="submissions" onPage={p => setFilters(f => ({ ...f, page: p }))} />
    </Section>
  )
}

// ───────────────────────────── 4 · lecture watch history ─────────────────────────────

// Recorded-lecture progress, grouped by the product it was watched under. This
// is watch time, not syllabus completion — a student can watch every video and
// still be short on attendance, which is exactly what an admin needs to see.
function LecturesSection({ studentId }) {
  const { data, error, loading } = useResource(`/api/admin/users/${studentId}/progress`, null)
  const [showAll, setShowAll] = useState(false)

  const groups = useMemo(() => {
    const byProduct = new Map()
    for (const p of data?.progress || []) {
      const key = p.productId?._id || p.productId || 'unknown'
      const g = byProduct.get(key) || { name: p.productId?.name || 'Unknown product', items: [], seconds: 0, completed: 0 }
      g.items.push(p)
      g.seconds += p.watchedSeconds || 0
      if (p.completed) g.completed += 1
      byProduct.set(key, g)
    }
    return [...byProduct.values()].sort((a, b) => b.seconds - a.seconds)
  }, [data])

  const total = data?.progress?.length || 0

  return (
    <Section id="lectures" index={4} title="Lecture watch history"
      subtitle="Recorded videos and PDFs this student has opened, newest first within each product.">
      {loading ? (
        <div className="p-5 space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-12 bg-gray-100 rounded-xl animate-pulse" />)}</div>
      ) : error ? (
        <Empty title="Couldn't load watch history" hint={error} />
      ) : !total ? (
        <Empty title="No watch history yet" hint="This student hasn't opened a recorded lecture." />
      ) : (
        <>
          <Tallies items={[
            { label: 'Items opened', value: total },
            { label: 'Completed',    value: data.progress.filter(p => p.completed).length, tone: 'emerald' },
            { label: 'Watch time',   value: fmtSeconds(data.totalSeconds), tone: 'indigo' },
          ]} />
          <div className="p-4 space-y-4">
            {groups.map((g, gi) => {
              const items = showAll ? g.items : g.items.slice(0, 8)
              return (
                <div key={gi}>
                  <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    {g.name} · {fmtSeconds(g.seconds)} · {g.completed}/{g.items.length} completed
                  </p>
                  <div className="space-y-1.5">
                    {items.map((p, i) => (
                      <div key={i} className="flex items-center gap-3 px-3 py-2 bg-gray-50 rounded-lg">
                        <Badge tone={p.contentId?.type === 'video' ? 'blue' : 'rose'}>{p.contentId?.type || 'file'}</Badge>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-900 truncate">{p.contentId?.title || 'Unknown'}</p>
                          <p className="text-[11px] text-gray-400 truncate">
                            {p.contentId?.subject ? `${p.contentId.subject} · ` : ''}
                            {fmtSeconds(p.watchedSeconds)} watched
                            {p.lastPosition > 0 && ` · at ${fmtSeconds(p.lastPosition)}`}
                          </p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-[11px] text-gray-400">{fmtDateTime(p.updatedAt)}</p>
                          {p.completed && <p className="text-[11px] font-semibold text-emerald-600">✓ Completed</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                  {!showAll && g.items.length > items.length && (
                    <p className="text-[11px] text-gray-400 mt-1.5">{g.items.length - items.length} more hidden</p>
                  )}
                </div>
              )
            })}
            {!showAll && groups.some(g => g.items.length > 8) && (
              <button onClick={() => setShowAll(true)}
                className="text-xs font-semibold text-indigo-600 hover:text-indigo-700">Show every item</button>
            )}
          </div>
        </>
      )}
    </Section>
  )
}

// ───────────────────────────── page ─────────────────────────────

const FORECAST_REASON = {
  complete:               'Syllabus complete',
  'no-syllabus':          'No syllabus scoped',
  'insufficient-history': 'Needs more history',
  'pace-too-slow':        'Pace too slow to project',
}

function Header({ student, enrolled }) {
  const session = student.activeSession
  return (
    <div className="bg-white rounded-2xl shadow-sm px-5 py-4 flex items-start gap-4 flex-wrap">
      <div className="w-12 h-12 rounded-full bg-indigo-100 flex items-center justify-center text-lg font-bold text-indigo-600 flex-shrink-0">
        {student.name?.[0]?.toUpperCase() || '?'}
      </div>
      <div className="flex-1 min-w-0">
        <h1 className="text-xl font-bold text-gray-900 truncate">{student.name || 'Unnamed student'}</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {student.phoneNumber || '—'}{student.email && ` · ${student.email}`}
        </p>
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          {enrolled ? <Badge tone="indigo">{enrolled}</Badge> : <Badge tone="amber">No course set</Badge>}
          {student.courses.length > 0 && <Badge tone="emerald">{student.courses.length} course{student.courses.length !== 1 ? 's' : ''}</Badge>}
          {student.source && <Badge tone="gray">via {student.source}</Badge>}
          <span className="text-[11px] text-gray-400">Joined {fmtDay(student.createdAt)}</span>
        </div>
        {student.caSubjects.length > 0 && (
          <p className="text-[11px] text-gray-400 mt-1.5 truncate" title={student.caSubjects.map(s => s.name).join(', ')}>
            Papers: {student.caSubjects.map(s => s.name).join(', ')}
          </p>
        )}
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Last login</p>
        <p className="text-sm text-gray-700 mt-0.5">{session?.lastLoginTime ? fmtDateTime(session.lastLoginTime) : 'Never'}</p>
        {session?.deviceName && (
          <p className="text-[11px] text-gray-400 mt-0.5">
            <span className="inline-block w-1.5 h-1.5 bg-green-500 rounded-full mr-1.5 align-middle" />
            {session.deviceName} ({session.deviceType || '—'})
          </p>
        )}
      </div>
    </div>
  )
}

export default function StudentProgressPage() {
  const { id } = useParams()
  const { data: report, error, loading, refresh } = useResource(`/api/admin/users/${id}/report`, null)

  // Hand-set chapter marks (✓ / ✗ on a topic row). The server re-judges the
  // item, so the report is re-fetched in place rather than patched locally.
  const [busyKey, setBusyKey] = useState('')
  const [note, setNote] = useState(null)
  useEffect(() => {
    if (!note) return
    const t = setTimeout(() => setNote(null), 1800)
    return () => clearTimeout(t)
  }, [note])
  async function markRow(row, mark) {
    if (busyKey) return   // one save at a time
    const key = `${row.subjectId}|${row.chapterId}|${row.unitId || ''}`
    setBusyKey(key)
    try {
      await apiFetch(`/api/admin/users/${id}/chapter-status`, {
        method: 'PUT',
        body: JSON.stringify({ subjectId: row.subjectId, chapterId: row.chapterId, unitId: row.unitId || null, mark }),
      })
      refresh()
      setNote({ text: mark === 'completed' ? `✓ ${row.unitName || row.chapterName} marked completed`
        : mark === 'absent' ? `✗ ${row.unitName || row.chapterName} marked absent`
        : `Mark cleared on ${row.unitName || row.chapterName}` })
    } catch (e) {
      setNote({ text: e.message || 'Could not save', bad: true })
    } finally {
      setBusyKey('')
    }
  }

  // Sections carry their own ids — no refs to thread through four components.
  const jump = (sectionId) => document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  const enrolled = report ? enrollmentLabel(report.student) : ''

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-24 bg-white rounded-2xl shadow-sm animate-pulse" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {Array(5).fill(0).map((_, i) => <div key={i} className="h-24 bg-white rounded-2xl shadow-sm animate-pulse" />)}
        </div>
        <div className="h-64 bg-white rounded-2xl shadow-sm animate-pulse" />
      </div>
    )
  }

  if (error || !report) {
    return (
      <div className="p-6">
        <Link to="/admin/users" className="text-sm text-indigo-600 hover:text-indigo-700">← Back to Users</Link>
        <div className="bg-white rounded-2xl shadow-sm mt-4">
          <Empty title="Couldn't load this student" hint={error || 'Student not found.'} />
        </div>
      </div>
    )
  }

  const { student, syllabus, classes, attendance, tests, lectures, forecast, thresholdPercent } = report

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between gap-4">
        <Link to="/admin/users" className="flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-900">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Users
        </Link>
        <div className="flex gap-1">
          {[['subjects', 'Subjects'], ['attendance', 'Attendance'], ['tests', 'Test marks'], ['lectures', 'Lectures']].map(([key, label]) => (
            <button key={key} onClick={() => jump(key)}
              className="text-xs font-semibold text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 px-3 py-1.5 rounded-lg transition-colors">
              {label}
            </button>
          ))}
        </div>
      </div>

      <Header student={student} enrolled={enrolled} />

      {note && (
        <div className={`fixed bottom-5 right-5 z-50 px-4 py-2.5 rounded-xl shadow-lg text-sm text-white ${note.bad ? 'bg-rose-600' : 'bg-gray-900'}`}>
          {note.text}
        </div>
      )}

      {!student.caLevel && !student.caSubjects.length && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 text-xs text-amber-800">
          No level or papers are set for this student, so the syllabus below lists only the chapters they have
          actually attended a class for — not what they still have left. Set it from <b>Users → Course</b>.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Overall progress" value={`${syllabus.percent}%`} tone={toneFor(syllabus.percent)} bar={syllabus.percent}
          sub={`${syllabus.completedItems} of ${syllabus.totalItems} topics done`}
          hint={`${syllabus.completedChapters}/${syllabus.totalChapters} chapters · ${syllabus.completedSubjects}/${syllabus.totalSubjects} subjects`} />

        <StatCard label="Attendance" value={`${attendance.percent}%`} tone={toneFor(attendance.percent)} bar={attendance.percent}
          sub={`${attendance.present} of ${attendance.sessions} classes cleared`}
          hint={`${fmtMs(attendance.attendedMs)} attended${thresholdPercent != null ? ` · bar is ${thresholdPercent}%` : ''}`} />

        <StatCard label="Test average"
          value={tests.evaluated ? `${tests.averagePercent}%` : '—'}
          tone={tests.evaluated ? toneFor(tests.averagePercent) : 'gray'}
          bar={tests.evaluated ? tests.averagePercent : null}
          sub={tests.evaluated ? `${tests.awarded} of ${tests.total} marks · ${tests.evaluated} evaluated` : 'No evaluated papers yet'}
          hint={tests.pending ? `${tests.pending} awaiting review` : tests.bestPercent != null ? `Best ${tests.bestPercent}%` : undefined} />

        <StatCard label="Lecture watch time" value={fmtSeconds(lectures.watchedSeconds)} tone="indigo"
          sub={`${lectures.completed} of ${lectures.lectures} items completed`}
          hint={lectures.lastWatchedAt ? `Last watched ${fmtDay(lectures.lastWatchedAt)}` : 'Never opened a lecture'} />

        <StatCard label="Estimated completion"
          value={forecast.estimatedCompletion ? fmtDay(forecast.estimatedCompletion) : '—'}
          tone={forecast.estimatedCompletion ? 'amber' : 'gray'}
          sub={forecast.estimatedCompletion
            ? `${forecast.remaining} topics left at ${forecast.itemsPerWeek}/week`
            : FORECAST_REASON[forecast.reason] || 'Not enough data'}
          hint={forecast.estimatedCompletion ? `Projected from ${forecast.basedOn} completed topics` : undefined} />
      </div>

      <SyllabusSection syllabus={syllabus} classes={classes} thresholdPercent={thresholdPercent} onMark={markRow} busyKey={busyKey} />
      <AttendanceSection studentId={id} />
      <TestMarksSection studentId={id} />
      <LecturesSection studentId={id} />
    </div>
  )
}
