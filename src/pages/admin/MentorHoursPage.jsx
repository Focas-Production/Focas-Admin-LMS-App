// Mentor Hours — per mentor, month by month: class slots booked vs actually
// attended, and booked ("working") hours vs the hours the mentor was really in
// the room. A slot is one block of the mentor's time: two tracks run together
// in the same 3-hour slot are ONE slot of 3 working hours, listed with both
// tracks' details underneath. Numbers come from /api/admin/mentor-hours.
// Click a month to see its slots; the CSV buttons give the same data.
import { Fragment, useState, useEffect, useMemo } from 'react'
import { apiFetch } from '../../api'

const selectCls = 'text-sm px-3 py-2 bg-white border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400'

// The three measures, each with its own colour everywhere on the page.
const WORK = 'text-sky-700'
const ACTUAL = 'text-emerald-700'
const SHORT = 'text-rose-600'

// Today in IST as a UTC-fields Date, so date maths never drift a day.
const istToday = () => new Date(Date.now() + 330 * 60 * 1000)
const ymd = (d) => d.toISOString().slice(0, 10)
// "2026-09-01": the 1st of the IST month n months from this one.
function monthFirst(offset = 0) {
  const d = istToday()
  return ymd(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1)))
}
// The last day of the month that `first` opens.
function monthLast(first) {
  const [y, m] = first.split('-').map(Number)
  return ymd(new Date(Date.UTC(y, m, 0)))
}
function daysAgo(n) {
  const d = istToday()
  return ymd(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - n)))
}
const fmtDate = (s) => new Date(`${s}T00:00:00+05:30`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })

// Quick ranges beside the date pickers.
function presets() {
  const today = daysAgo(0)
  const weekday = (istToday().getUTCDay() + 6) % 7   // Monday = 0
  return [
    { label: 'Today', from: today, to: today },
    { label: 'Yesterday', from: daysAgo(1), to: daysAgo(1) },
    { label: 'This week', from: daysAgo(weekday), to: today },
    { label: 'Last 7 days', from: daysAgo(6), to: today },
    { label: 'This month', from: monthFirst(0), to: today },
    { label: 'Last month', from: monthFirst(-1), to: monthLast(monthFirst(-1)) },
    { label: 'Last 6 months', from: monthFirst(-5), to: today },
  ]
}

const monthLabel = (ym) => new Date(`${ym}-01T00:00:00+05:30`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
const fmtHours = (ms) => {
  const m = Math.round((ms || 0) / 60000)
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}
const decHours = (ms) => ((ms || 0) / 3600000).toFixed(2)
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0)
const shortBy = (r) => Math.max(0, (r.workingMs || 0) - (r.actualMs || 0))
const fmtTime = (d) => (d ? new Date(d).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '—')
const fmtDay = (d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', weekday: 'short', timeZone: 'Asia/Kolkata' })
const trackName = (t) => [t.room, t.track].filter(Boolean).join(' · ') || t.title

function pctTone(p) {
  if (p >= 90) return { text: 'text-emerald-600', bar: 'bg-emerald-500' }
  if (p >= 70) return { text: 'text-amber-600', bar: 'bg-amber-400' }
  return { text: 'text-rose-600', bar: 'bg-rose-500' }
}

// Actual % as a number plus a small bar, so it reads at a glance.
function PctCell({ actualMs, workingMs, bold }) {
  const p = pct(actualMs, workingMs)
  const tone = pctTone(p)
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="w-16 h-1.5 rounded-full bg-gray-100 overflow-hidden hidden sm:block">
        <div className={`h-full ${tone.bar}`} style={{ width: `${Math.min(100, p)}%` }} />
      </div>
      <span className={`tabular-nums w-10 text-right ${tone.text} ${bold ? 'font-semibold' : ''}`}>{p}%</span>
    </div>
  )
}

function saveCsv(lines, name) {
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}
const csv = (cells) => cells.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')

// One line per mentor per month, plus the mentor's total.
function downloadSummary(groups, from, to) {
  const lines = [csv(['Mentor', 'Phone', 'Month', 'Slots booked', 'Slots attended', 'Tracks booked', 'Tracks attended',
    'Working hours (booked slots)', 'Working hours (attended slots)', 'Actual hours', 'Short by (hours)',
    'Actual % of booked', 'Actual % of attended'])]
  for (const g of groups) {
    for (const r of [...g.months, { ...g, month: null }]) {
      lines.push(csv([g.name, g.phoneNumber, r.month ? monthLabel(r.month) : 'TOTAL',
        r.slotCount, r.attendedCount, r.trackCount, r.trackAttendedCount,
        decHours(r.workingMs), decHours(r.attendedWorkingMs), decHours(r.actualMs), decHours(shortBy(r)),
        pct(r.actualMs, r.workingMs), pct(r.actualMs, r.attendedWorkingMs)]))
    }
  }
  saveCsv(lines, `mentor-hours-summary-${from}-to-${to}.csv`)
}

// One line per track. Slot hours sit on the slot's first track only, so a
// column sum in Excel still counts a two-track slot once.
function downloadDetail(groups, from, to) {
  const lines = [csv(['Mentor', 'Phone', 'Month', 'Date', 'Slot time', 'Slot working hours', 'Slot actual hours', 'Slot actual %',
    'Room · Track', 'Subject', 'Chapter', 'Unit', 'Class started', 'Class ended', 'Mentor time in this track (hours)'])]
  for (const g of groups) {
    for (const r of g.months) {
      for (const s of r.slots) {
        s.tracks.forEach((t, i) => {
          const first = i === 0
          lines.push(csv([g.name, g.phoneNumber, monthLabel(r.month), fmtDay(s.start), `${fmtTime(s.start)} – ${fmtTime(s.end)}`,
            first ? decHours(s.workingMs) : '', first ? decHours(s.actualMs) : '', first ? pct(s.actualMs, s.workingMs) : '',
            trackName(t), t.subject, t.chapter, t.unit,
            t.startedAt ? fmtTime(t.startedAt) : 'Not started', t.endedAt ? fmtTime(t.endedAt) : '', decHours(t.actualMs)]))
        })
      }
    }
  }
  saveCsv(lines, `mentor-hours-detail-${from}-to-${to}.csv`)
}

// A month's slots: slot time and hours on the left, every track of the slot
// listed on the right with its own subject, chapter, times and room time.
function SlotTable({ slots }) {
  return (
    <table className="w-full text-xs mt-1">
      <thead>
        <tr className="text-left text-gray-400 border-b border-gray-200">
          <th className="py-1.5 pr-3 font-medium">Date · Slot</th>
          <th className="py-1.5 pr-3 font-medium">Track · Subject · Chapter</th>
          <th className="py-1.5 pr-3 font-medium whitespace-nowrap">Class ran</th>
          <th className="py-1.5 pr-3 font-medium text-right whitespace-nowrap">In this track</th>
          <th className={`py-1.5 pr-3 font-medium text-right whitespace-nowrap ${WORK}`}>Working</th>
          <th className={`py-1.5 pr-3 font-medium text-right whitespace-nowrap ${ACTUAL}`}>Actual</th>
          <th className="py-1.5 font-medium text-right">Actual %</th>
        </tr>
      </thead>
      <tbody>
        {slots.map((s) => (
          s.tracks.map((t, i) => (
            <tr key={t.id} className={`align-top ${i === 0 ? 'border-t border-gray-200' : ''}`}>
              {i === 0 && (
                <td rowSpan={s.tracks.length} className="py-2 pr-3 whitespace-nowrap">
                  <p className="font-medium text-gray-800">{fmtDay(s.start)}</p>
                  <p className="text-gray-500">{fmtTime(s.start)} – {fmtTime(s.end)}</p>
                  {s.tracks.length > 1 && (
                    <span className="inline-block mt-1 px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 text-[10px] font-medium">
                      {s.tracks.length} tracks · counted once
                    </span>
                  )}
                </td>
              )}
              <td className="py-2 pr-3">
                <p className="font-medium text-gray-800">{trackName(t)}</p>
                <p className="text-gray-600">{t.subject || t.title}</p>
                {(t.chapter || t.unit) && <p className="text-gray-400">{[t.chapter, t.unit].filter(Boolean).join(' / ')}</p>}
              </td>
              <td className="py-2 pr-3 whitespace-nowrap text-gray-600">
                {t.startedAt ? `${fmtTime(t.startedAt)} → ${t.status === 'live' ? 'live now' : fmtTime(t.endedAt)}` : <span className="text-rose-500">Not started</span>}
              </td>
              <td className={`py-2 pr-3 text-right tabular-nums whitespace-nowrap ${t.attended ? 'text-gray-600' : 'text-rose-500'}`}>
                {t.attended ? fmtHours(t.actualMs) : 'Not joined'}
              </td>
              {i === 0 && (
                <>
                  <td rowSpan={s.tracks.length} className={`py-2 pr-3 text-right tabular-nums font-medium ${WORK}`}>{fmtHours(s.workingMs)}</td>
                  <td rowSpan={s.tracks.length} className={`py-2 pr-3 text-right tabular-nums font-medium ${s.attended ? ACTUAL : SHORT}`}>
                    {s.attended ? fmtHours(s.actualMs) : 'Absent'}
                  </td>
                  <td rowSpan={s.tracks.length} className="py-2"><PctCell actualMs={s.actualMs} workingMs={s.workingMs} /></td>
                </>
              )}
            </tr>
          ))
        ))}
      </tbody>
    </table>
  )
}

// The counts a mentor's total row adds up from its month rows.
const SUM_KEYS = ['slotCount', 'attendedCount', 'trackCount', 'trackAttendedCount', 'workingMs', 'attendedWorkingMs', 'actualMs']
const zeroTotals = () => Object.fromEntries(SUM_KEYS.map((k) => [k, 0]))

// "41 / 43" with the missed count underneath when any were missed.
function OfCell({ done, of, bold }) {
  return (
    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
      <span className={bold ? 'font-semibold' : ''}>{done}</span>
      <span className="text-gray-400"> / {of}</span>
      {done < of && <p className="text-[10px] text-rose-500">{of - done} missed</p>}
    </td>
  )
}

// The number columns, shared by a mentor's total row and each month row.
function NumberCells({ r, bold }) {
  const td = `px-3 py-2 text-right tabular-nums whitespace-nowrap ${bold ? 'font-semibold' : ''}`
  return (
    <>
      <OfCell done={r.attendedCount} of={r.slotCount} bold={bold} />
      <OfCell done={r.trackAttendedCount} of={r.trackCount} bold={bold} />
      <td className={`${td} ${WORK}`}>{fmtHours(r.workingMs)}</td>
      <td className={`${td} ${WORK} bg-sky-50/50`}>{fmtHours(r.attendedWorkingMs)}</td>
      <td className={`${td} ${ACTUAL}`}>{fmtHours(r.actualMs)}</td>
      <td className={`${td} ${SHORT}`}>{fmtHours(shortBy(r))}</td>
      <td className="px-3 py-2"><PctCell actualMs={r.actualMs} workingMs={r.workingMs} bold={bold} /></td>
      <td className="px-3 py-2"><PctCell actualMs={r.actualMs} workingMs={r.attendedWorkingMs} bold={bold} /></td>
    </>
  )
}

export default function MentorHoursPage() {
  const [from, setFrom] = useState(() => monthFirst(0))
  const [to, setTo] = useState(() => daysAgo(0))
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(() => new Set())   // `${mentorId}|${month}` rows showing their slots
  // `key` is the range the held data belongs to — anything else is loading.
  const [state, setState] = useState({ key: null, rows: [], error: '' })
  const rangeKey = `${from}|${to}`

  useEffect(() => {
    if (!from || !to) return
    let alive = true
    apiFetch(`/api/admin/mentor-hours?from=${from}&to=${to}`)
      .then((d) => alive && setState({ key: `${from}|${to}`, rows: d.rows || [], error: '' }))
      .catch((e) => alive && setState({ key: `${from}|${to}`, rows: [], error: e.message || 'Failed to load' }))
    return () => { alive = false }
  }, [from, to])

  const loading = state.key !== rangeKey

  // One group per mentor with range totals; months newest first.
  const groups = useMemo(() => {
    const m = new Map()
    for (const r of state.rows) {
      if (!m.has(r.mentorId)) {
        m.set(r.mentorId, { mentorId: r.mentorId, name: r.name, phoneNumber: r.phoneNumber, role: r.role,
          months: [], ...zeroTotals() })
      }
      const g = m.get(r.mentorId)
      g.months.push(r)
      for (const k of SUM_KEYS) g[k] += r[k] || 0
    }
    const q = query.trim().toLowerCase()
    return [...m.values()]
      .filter((g) => !q || g.name.toLowerCase().includes(q) || g.phoneNumber.includes(q))
      .map((g) => ({ ...g, months: g.months.sort((a, b) => b.month.localeCompare(a.month)) }))
  }, [state.rows, query])

  const total = groups.reduce((t, g) => {
    for (const k of SUM_KEYS) t[k] += g[k]
    return t
  }, zeroTotals())

  function toggle(key) {
    setOpen((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n })
  }

  const tiles = [
    { label: 'Slots attended / booked', value: `${total.attendedCount} / ${total.slotCount}`, sub: `${total.slotCount - total.attendedCount} missed`, cls: 'text-gray-900' },
    { label: 'Tracks attended / booked', value: `${total.trackAttendedCount} / ${total.trackCount}`, sub: `${total.trackCount - total.trackAttendedCount} missed`, cls: 'text-gray-900' },
    { label: 'Working hours · booked slots', value: fmtHours(total.workingMs), sub: `All ${total.slotCount} booked slots`, cls: WORK, ring: 'border-l-4 border-sky-400' },
    { label: 'Working hours · attended slots', value: fmtHours(total.attendedWorkingMs), sub: `The ${total.attendedCount} slots attended`, cls: WORK, ring: 'border-l-4 border-sky-200' },
    { label: 'Actual hours', value: fmtHours(total.actualMs), sub: 'Mentor in class', cls: ACTUAL, ring: 'border-l-4 border-emerald-400' },
    { label: 'Short by', value: fmtHours(shortBy(total)), sub: 'Booked − Actual', cls: SHORT, ring: 'border-l-4 border-rose-300' },
    { label: 'Actual % of booked', value: `${pct(total.actualMs, total.workingMs)}%`, sub: 'Actual ÷ booked hours', cls: pctTone(pct(total.actualMs, total.workingMs)).text },
    { label: 'Actual % of attended', value: `${pct(total.actualMs, total.attendedWorkingMs)}%`, sub: 'Actual ÷ attended-slot hours', cls: pctTone(pct(total.actualMs, total.attendedWorkingMs)).text },
  ]

  const th = 'px-4 py-2.5 font-semibold text-right whitespace-nowrap'

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Mentor Hours</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            Slots booked vs attended, and working hours vs actual hours in class — month by month.
          </p>
        </div>
        <div className="w-full flex flex-wrap items-center gap-1.5 order-last">
          {presets().map((p) => {
            const active = p.from === from && p.to === to
            return (
              <button key={p.label} type="button" onClick={() => { setFrom(p.from); setTo(p.to) }}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${active
                  ? 'bg-indigo-600 border-indigo-600 text-white'
                  : 'bg-white border-gray-200 text-gray-600 hover:border-indigo-300 hover:text-indigo-600'}`}>
                {p.label}
              </button>
            )
          })}
          <span className="text-xs text-gray-400 ml-2">
            Showing {from === to ? fmtDate(from) : `${fmtDate(from)} – ${fmtDate(to)}`}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 ml-auto">
          <label className="text-xs text-gray-500">From</label>
          <input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className={selectCls} />
          <label className="text-xs text-gray-500">To</label>
          <input type="date" value={to} min={from} max={daysAgo(0)} onChange={(e) => e.target.value && setTo(e.target.value)} className={selectCls} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search mentor or phone…"
            className={`${selectCls} w-52`} />
          <button type="button" onClick={() => downloadSummary(groups, from, to)} disabled={loading || !groups.length}
            className="text-sm px-3 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-40">
            Summary CSV
          </button>
          <button type="button" onClick={() => downloadDetail(groups, from, to)} disabled={loading || !groups.length}
            className="text-sm px-3 py-2 rounded-lg border border-indigo-200 text-indigo-700 font-medium hover:bg-indigo-50 disabled:opacity-40">
            Detailed CSV
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {tiles.map((t) => (
          <div key={t.label} className={`bg-white rounded-2xl shadow-sm px-4 py-3 ${t.ring || ''}`}>
            <p className="text-xs text-gray-400">{t.label}</p>
            <p className={`text-2xl font-bold mt-1 tabular-nums ${t.cls}`}>{loading ? '…' : t.value}</p>
            <p className="text-[11px] text-gray-400 mt-0.5">{t.sub}</p>
          </div>
        ))}
      </div>

      {state.error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-xl px-4 py-3">{state.error}</div>
      )}

      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-sm text-gray-400">Loading…</div>
        ) : !groups.length ? (
          <div className="p-10 text-center text-sm text-gray-400">
            {state.rows.length ? 'No mentor matches this search.' : 'No live classes in this period.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500">
                  <th rowSpan={2} className="px-4 py-2.5 font-semibold text-left align-bottom border-b border-gray-100">Mentor / Month</th>
                  <th rowSpan={2} className={`${th} align-bottom border-b border-gray-100`}>Slots<br /><span className="font-normal text-gray-400">attended / booked</span></th>
                  <th rowSpan={2} className={`${th} align-bottom border-b border-gray-100`}>Tracks<br /><span className="font-normal text-gray-400">attended / booked</span></th>
                  <th colSpan={2} className={`${th} text-center ${WORK} border-b border-sky-100`}>Working hours</th>
                  <th rowSpan={2} className={`${th} align-bottom border-b border-gray-100 ${ACTUAL}`}>Actual hours</th>
                  <th rowSpan={2} className={`${th} align-bottom border-b border-gray-100 ${SHORT}`}>Short by</th>
                  <th colSpan={2} className={`${th} text-center border-b border-gray-100`}>Actual %</th>
                </tr>
                <tr className="text-[11px] text-gray-500 border-b border-gray-100">
                  <th className={`${th} ${WORK}`}>Booked slots</th>
                  <th className={`${th} ${WORK} bg-sky-50/50`}>Attended slots</th>
                  <th className={th}>of booked</th>
                  <th className={th}>of attended</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <Fragment key={g.mentorId}>
                    <tr className="bg-gray-50 border-t border-gray-200">
                      <td className="px-4 py-2.5">
                        <p className="font-semibold text-gray-900">{g.name}</p>
                        <p className="text-[11px] text-gray-400">{g.phoneNumber}{g.role === 'admin' ? ' · admin' : ''} · total for selected dates</p>
                      </td>
                      <NumberCells r={g} bold />
                    </tr>
                    {g.months.map((r) => {
                      const key = `${g.mentorId}|${r.month}`
                      const isOpen = open.has(key)
                      return (
                        <Fragment key={key}>
                          <tr onClick={() => toggle(key)} className="border-t border-gray-100 hover:bg-indigo-50/40 cursor-pointer">
                            <td className="px-4 py-2 pl-8 text-gray-700">
                              <span className="inline-block w-4 text-gray-400">{isOpen ? '▾' : '▸'}</span>
                              {monthLabel(r.month)}
                            </td>
                            <NumberCells r={r} />
                          </tr>
                          {isOpen && (
                            <tr>
                              <td colSpan={10} className="px-4 pb-3 pl-12 bg-gray-50/60">
                                <SlotTable slots={r.slots} />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="text-[11px] text-gray-500 space-y-0.5">
        <p><b>Slots</b> — a slot is one block of the mentor&apos;s time. Two tracks run together in the same slot are one slot (and two <b>tracks</b>). Attended = the mentor joined it.</p>
        <p><b className={WORK}>Working hours · booked slots</b> — booked time of every slot. <b className={WORK}>· attended slots</b> — booked time of only the slots the mentor joined. A 3-hour slot on two tracks is 3 hours, not 6.</p>
        <p><b className={ACTUAL}>Actual hours</b> — the mentor&apos;s own time in class (join → leave), across both tracks, counted once.</p>
        <p><b className={SHORT}>Short by</b> = Booked − Actual. <b>Actual % of booked</b> = Actual ÷ booked-slot hours. <b>Actual % of attended</b> = Actual ÷ attended-slot hours (how long they stayed in the classes they came to). <b>In this track</b> = the mentor&apos;s time in that one track&apos;s room.</p>
        <p className="text-gray-400">Cancelled and future classes are left out. A slot the mentor never joined counts as missed.</p>
      </div>
    </div>
  )
}
