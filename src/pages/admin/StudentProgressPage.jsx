// Admin → Users → Progress. One student, everything we know about them:
// syllabus completion, live-class attendance, test-series marks and lecture
// watch history. Replaces the old Chapter Progress modal — a modal couldn't
// hold paginated logs, and this is the screen an admin sits with on a call.
//
// Three requests back it: /report (header, KPIs, subject tree — one bounded
// document), plus /attendance-log and /test-marks, which are paginated and
// filtered independently because a year of classes is not one payload. The
// lecture list reuses the existing /progress endpoint.
import { useState, useEffect, useMemo } from 'react'
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

// A row of "12 Present" style counters above a log table.
function Tallies({ items }) {
  return (
    <div className="flex items-center gap-5 px-5 py-3 border-b border-gray-100 flex-wrap">
      {items.map(t => (
        <div key={t.label}>
          <p className={`text-base font-bold leading-tight ${TEXT_TONES[t.tone] || 'text-gray-900'}`}>{t.value}</p>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{t.label}</p>
        </div>
      ))}
    </div>
  )
}

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

  useEffect(() => {
    let alive = true
    apiFetch(url)
      .then(d => alive && setState({ key: url, data: d, error: '' }))
      .catch(e => alive && setState(prev => ({ key: url, data: prev.data, error: e.message || 'Failed to load' })))
    return () => { alive = false }
  }, [url])

  const settled = state.key === url
  return { data: state.data, error: settled ? state.error : '', loading: !settled }
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

const SUBJECT_FILTERS = [
  { key: 'all',         label: 'All' },
  { key: 'in-progress', label: 'In progress' },
  { key: 'completed',   label: 'Completed' },
  { key: 'not-started', label: 'Not started' },
]

// Why an item is still open. The distinction matters: "mentor still teaching"
// is nobody's fault, "attendance short" is the student's to fix.
function reasonLabel(row) {
  if (row.completed) return null
  if (row.reason === 'teaching')   return { text: 'mentor still teaching', cls: 'text-amber-600' }
  if (row.reason === 'attendance') return { text: 'attendance short', cls: 'text-rose-500' }
  return null
}

function ItemRow({ row }) {
  const reason = reasonLabel(row)
  return (
    <div className="flex items-center gap-3 px-3 py-2 bg-gray-50 rounded-lg">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-900 truncate">{row.unitName || row.chapterName}</p>
        <p className="text-[11px] text-gray-400 mt-0.5">
          {row.sessions
            ? `${row.sessions} session${row.sessions !== 1 ? 's' : ''} · ${row.percent}% attended`
            : 'No class held yet'}
          {reason && <span className={reason.cls}> · {reason.text}</span>}
        </p>
      </div>
      <Badge tone={row.completed ? 'emerald' : 'gray'}
        title={row.source === 'manual' ? `Edited by ${row.markedByName || 'mentor'}` : 'Auto-computed from attendance'}>
        {row.completed ? '✓ Done' : 'Not done'}{row.source === 'manual' && <span className="ml-0.5 opacity-60">✎</span>}
      </Badge>
    </div>
  )
}

function SubjectCard({ subject, query, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen)

  const q = query.trim().toLowerCase()
  // A live search forces every card open — collapsed matches would look like
  // no match at all.
  const expanded = q ? true : open
  const chapters = q
    ? subject.chapters
        .map(ch => ch.name.toLowerCase().includes(q)
          ? ch
          : { ...ch, rows: ch.rows.filter(r => (r.unitName || '').toLowerCase().includes(q)) })
        .filter(ch => ch.rows.length)
    : subject.chapters

  const tone = subject.status === 'completed' ? 'emerald' : toneFor(subject.percent)
  const pending = subject.totalItems - subject.completedItems

  return (
    <div className="border border-gray-100 rounded-xl overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors">
        <span className="text-gray-300 text-xs w-3 flex-shrink-0">{expanded ? '▾' : '▸'}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-gray-900 truncate">{subject.name}</p>
            {subject.status === 'completed' && <Badge tone="emerald">Completed</Badge>}
            {subject.status === 'not-started' && <Badge tone="gray">Not started</Badge>}
          </div>
          <div className="flex items-center gap-3 mt-1.5">
            <Bar percent={subject.percent} tone={tone} className="flex-1 max-w-[220px]" />
            <span className={`text-xs font-semibold ${TEXT_TONES[tone]}`}>{subject.percent}%</span>
            <span className="text-[11px] text-gray-400 truncate">
              {subject.completedChapters}/{subject.totalChapters} chapters ·{' '}
              {subject.completedItems}/{subject.totalItems} topics ·{' '}
              {subject.sessions} session{subject.sessions !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
        {pending > 0 && <span className="text-[11px] text-gray-400 flex-shrink-0">{pending} pending</span>}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {!chapters.length ? (
            <p className="text-xs text-gray-400 py-2">Nothing matches this search in {subject.name}.</p>
          ) : chapters.map(ch => {
            // A chapter with no units is a single row that already carries its
            // own name — repeating it as a heading would just be noise.
            const single = ch.rows.length === 1 && !ch.rows[0].unitName
            return (
              <div key={ch.chapterId}>
                {!single && (
                  <div className="flex items-center gap-2 mb-1.5 pl-1">
                    <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide truncate">{ch.name}</p>
                    <Bar percent={ch.percent} tone={ch.completed ? 'emerald' : toneFor(ch.percent)} className="flex-1 max-w-[120px]" />
                    <span className="text-[10px] text-gray-400 flex-shrink-0">{ch.done}/{ch.total}</span>
                  </div>
                )}
                <div className="space-y-1.5">
                  {ch.rows.map(r => <ItemRow key={`${r.chapterId}:${r.unitId || ''}`} row={r} />)}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function SyllabusSection({ syllabus, thresholdPercent }) {
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')

  const q = query.trim().toLowerCase()
  const visible = syllabus.subjects.filter(s =>
    (filter === 'all' || s.status === filter) &&
    (!q || s.name.toLowerCase().includes(q) ||
      s.chapters.some(ch => ch.name.toLowerCase().includes(q) || ch.rows.some(r => (r.unitName || '').toLowerCase().includes(q)))))

  const counts = SUBJECT_FILTERS.reduce((a, f) => ({
    ...a, [f.key]: f.key === 'all' ? syllabus.subjects.length : syllabus.subjects.filter(s => s.status === f.key).length,
  }), {})

  return (
    <Section id="subjects" index={1} title="Subject-wise progress"
      subtitle={thresholdPercent != null
        ? `A topic counts as completed once the mentor has taught it and this student attended ≥${thresholdPercent}% of its sessions.`
        : undefined}>
      <Tallies items={[
        { label: 'Subjects done',  value: `${syllabus.completedSubjects}/${syllabus.totalSubjects}`, tone: 'emerald' },
        { label: 'Chapters done',  value: `${syllabus.completedChapters}/${syllabus.totalChapters}`, tone: 'emerald' },
        { label: 'Topics done',    value: `${syllabus.completedItems}/${syllabus.totalItems}`,       tone: 'emerald' },
        { label: 'Chapters left',  value: syllabus.totalChapters - syllabus.completedChapters,       tone: 'amber' },
        { label: 'Topics left',    value: syllabus.totalItems - syllabus.completedItems,             tone: 'amber' },
      ]} />

      <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-100 flex-wrap">
        <div className="flex gap-1">
          {SUBJECT_FILTERS.map(f => (
            <Chip key={f.key} active={filter === f.key} onClick={() => setFilter(f.key)}
              tone={f.key === 'completed' ? 'emerald' : f.key === 'not-started' ? 'gray' : 'indigo'}>
              {f.label} {counts[f.key]}
            </Chip>
          ))}
        </div>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search subject, chapter or topic…"
          className={`${inputCls} ml-auto w-56`} />
      </div>

      <div className="p-4 space-y-2">
        {!syllabus.subjects.length ? (
          <Empty title="Nothing to show yet"
            hint="This student has no enrolled level and hasn't attended a class tied to a chapter." />
        ) : !visible.length ? (
          <Empty title="No match" hint="Nothing here matches the current filter." />
        ) : visible.map(s => (
          <SubjectCard key={s.subjectId} subject={s} query={query} defaultOpen={visible.length <= 3} />
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
                          {[r.chapter?.name, r.unit?.name].filter(Boolean).join(' · ') || '—'}
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

// Per-subject marks, straight off the report. Answers "how is he doing in
// Costing specifically" without having to filter the log first.
function SubjectMarks({ bySubject }) {
  if (!bySubject.length) return null
  return (
    <div className="px-5 py-3 border-b border-gray-100">
      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Marks by subject</p>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {bySubject.map(s => (
          <div key={s.subjectId || s.name} className="flex items-center gap-3 bg-gray-50 rounded-lg px-3 py-2">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-gray-900 truncate" title={s.name}>{s.name}</p>
              <p className="text-[11px] text-gray-400">
                {s.evaluated}/{s.submitted} evaluated
                {s.evaluated > 0 && ` · ${s.awarded}/${s.total} marks`}
                {s.bestPercent != null && ` · best ${s.bestPercent}%`}
              </p>
            </div>
            {s.evaluated > 0 ? (
              <span className={`text-sm font-bold flex-shrink-0 ${TEXT_TONES[toneFor(s.percent)]}`}>{s.percent}%</span>
            ) : (
              <span className="text-[11px] text-gray-300 flex-shrink-0">not evaluated</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function TestMarksSection({ studentId, bySubject }) {
  const [filters, setFilters] = useState({ page: 1, limit: 20, status: '', subjectId: '', dateFrom: '', dateTo: '' })
  const [fileError, setFileError] = useState('')
  const set = (patch) => setFilters(f => ({ ...f, page: 1, ...patch }))
  const { data, error, loading } = useResource(`/api/admin/users/${studentId}/test-marks`, filters)

  const rows = data?.rows || []
  const s = data?.summary

  return (
    <Section id="tests" index={3} title="Test marks"
      subtitle="Date-wise test submissions with the marks awarded. Filter by subject to see one paper's history.">
      {s && (
        <Tallies items={[
          { label: 'Submitted', value: s.submitted },
          { label: 'Evaluated', value: s.evaluated, tone: 'emerald' },
          { label: 'Awaiting review', value: s.pending, tone: 'amber' },
          { label: 'Marks', value: s.evaluated ? `${s.awarded}/${s.total}` : '—' },
          { label: 'Average', value: s.evaluated ? `${s.averagePercent}%` : '—', tone: s.evaluated ? toneFor(s.averagePercent) : 'gray' },
        ]} />
      )}

      <SubjectMarks bySubject={bySubject || []} />

      <LogFilters
        subjects={data?.subjects || []} status={filters.status}
        subjectId={filters.subjectId} onSubject={v => set({ subjectId: v })}
        dateFrom={filters.dateFrom} dateTo={filters.dateTo}
        onDate={(which, v) => set(which === 'from' ? { dateFrom: v } : { dateTo: v })}
        onReset={() => set({ subjectId: '', dateFrom: '', dateTo: '', status: '' })}>
        <div className="flex gap-1">
          {TEST_STATUS.map(o => (
            <Chip key={o.key} active={filters.status === o.key} onClick={() => set({ status: o.key })} tone={o.tone}>{o.label}</Chip>
          ))}
        </div>
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
                          {[r.level, r.testSeriesType, r.testDuration ? `${r.testDuration} min` : null].filter(Boolean).join(' · ') || '—'}
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
  const { data: report, error, loading } = useResource(`/api/admin/users/${id}/report`, null)

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

  const { student, syllabus, attendance, tests, lectures, forecast, thresholdPercent } = report

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

      <SyllabusSection syllabus={syllabus} thresholdPercent={thresholdPercent} />
      <AttendanceSection studentId={id} />
      <TestMarksSection studentId={id} bySubject={tests.bySubject} />
      <LecturesSection studentId={id} />
    </div>
  )
}
