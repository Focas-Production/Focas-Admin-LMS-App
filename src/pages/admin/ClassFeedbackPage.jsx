// Class Feedback — what students said about their live classes: 1–5 stars for
// each of three areas (Conceptual clarity, Attention, Doubt solving) and a
// comment, both optional, given after the class ends. Shows the overall rating
// and each area's, one row per mentor (overall, each area, the area they lag
// in, star split, response rate), and the answers themselves with filters.
// An answer's overall rating is the average of its three areas; answers from
// before the areas existed have an overall rating only. Numbers come from
// /api/admin/class-feedback/summary, the answers from /api/admin/class-feedback.
// Classes are placed by their scheduled start date (IST).
import { useState, useEffect } from 'react'
import { apiFetch } from '../../api'

const selectCls = 'text-sm px-3 py-2 bg-white border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400'
const PAGE_SIZE = 25
// Below this many ratings an average says little — the table marks it.
const FEW_RATINGS = 5
// Fallback until the summary (which carries the server's list) has loaded.
const AREAS = [
  { key: 'clarity', label: 'Conceptual clarity' },
  { key: 'attention', label: 'Attention' },
  { key: 'doubts', label: 'Doubt solving' },
]

// Today in IST as a UTC-fields Date, so date maths never drift a day.
const istToday = () => new Date(Date.now() + 330 * 60 * 1000)
const ymd = (d) => d.toISOString().slice(0, 10)
function monthFirst(offset = 0) {
  const d = istToday()
  return ymd(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1)))
}
function monthLast(first) {
  const [y, m] = first.split('-').map(Number)
  return ymd(new Date(Date.UTC(y, m, 0)))
}
function daysAgo(n) {
  const d = istToday()
  return ymd(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - n)))
}
const fmtDate = (s) => new Date(`${s}T00:00:00+05:30`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
const fmtWhen = (d) => new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })

function presets() {
  const today = daysAgo(0)
  return [
    { label: 'Today', from: today, to: today },
    { label: 'Yesterday', from: daysAgo(1), to: daysAgo(1) },
    { label: 'Last 7 days', from: daysAgo(6), to: today },
    { label: 'Last 30 days', from: daysAgo(29), to: today },
    { label: 'This month', from: monthFirst(0), to: today },
    { label: 'Last month', from: monthFirst(-1), to: monthLast(monthFirst(-1)) },
    { label: 'Last 3 months', from: monthFirst(-2), to: today },
    { label: 'Last 6 months', from: monthFirst(-5), to: today },
  ]
}

const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0)
const fmtAvg = (v) => (v == null ? '—' : v.toFixed(1))

function avgTone(v) {
  if (v == null) return 'text-gray-400'
  if (v >= 4.2) return 'text-emerald-600'
  if (v >= 3.5) return 'text-amber-600'
  return 'text-rose-600'
}

// Five stars, filled to the (possibly fractional) value.
function Stars({ value, size = 'w-4 h-4' }) {
  const v = value || 0
  return (
    <span className="inline-flex" aria-label={`${fmtAvg(value)} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => {
        const fill = Math.max(0, Math.min(1, v - (n - 1)))
        return (
          <span key={n} className={`relative inline-block ${size}`}>
            <svg viewBox="0 0 24 24" className={`absolute inset-0 ${size} text-gray-200`} fill="currentColor"><path d={STAR} /></svg>
            <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
              <svg viewBox="0 0 24 24" className={`${size} text-amber-400`} fill="currentColor"><path d={STAR} /></svg>
            </span>
          </span>
        )
      })}
    </span>
  )
}
const STAR = 'M12 2.5l2.94 5.96 6.58.96-4.76 4.64 1.12 6.55L12 17.52l-5.88 3.09 1.12-6.55L2.48 9.42l6.58-.96L12 2.5z'

// One colour per star count, used by the bars and the pills alike.
const STAR_BAR = { 5: 'bg-emerald-500', 4: 'bg-lime-500', 3: 'bg-amber-400', 2: 'bg-orange-500', 1: 'bg-rose-500' }
const STAR_PILL = {
  5: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  4: 'bg-lime-50 text-lime-700 border-lime-200',
  3: 'bg-amber-50 text-amber-700 border-amber-200',
  2: 'bg-orange-50 text-orange-700 border-orange-200',
  1: 'bg-rose-50 text-rose-700 border-rose-200',
}

// Mentor row: a stacked 5★→1★ bar, with a pill for each star count actually
// given underneath ("5★ × 3"), so nothing has to be squeezed in as labels.
function StarSplit({ stars, total }) {
  if (!total) return <span className="text-sm text-gray-300">No ratings yet</span>
  return (
    <div className="w-48">
      <div className="flex h-2.5 rounded-full overflow-hidden bg-gray-100">
        {[5, 4, 3, 2, 1].map((s) => stars[s] > 0 && (
          <div key={s} className={STAR_BAR[s]} style={{ width: `${(stars[s] / total) * 100}%` }} title={`${s}★: ${stars[s]}`} />
        ))}
      </div>
      <div className="flex flex-wrap gap-1 mt-1.5">
        {[5, 4, 3, 2, 1].filter((s) => stars[s] > 0).map((s) => (
          <span key={s} className={`text-xs font-semibold px-1.5 py-0.5 rounded-md border tabular-nums ${STAR_PILL[s]}`}>
            {s}★ × {stars[s]}
          </span>
        ))}
      </div>
    </div>
  )
}

// Overall: one row per star count — label, bar, count and share.
function StarHistogram({ stars, total }) {
  return (
    <div className="space-y-1.5">
      {[5, 4, 3, 2, 1].map((s) => {
        const p = pct(stars[s], total)
        return (
          <div key={s} className="flex items-center gap-3 text-sm">
            <span className="w-10 font-semibold text-gray-700 tabular-nums">{s} ★</span>
            <div className="flex-1 h-3 rounded-full bg-gray-100 overflow-hidden">
              <div className={`h-full rounded-full ${STAR_BAR[s]}`} style={{ width: `${p}%` }} />
            </div>
            <span className="w-24 text-right tabular-nums text-gray-700">
              <b>{stars[s]}</b> <span className="text-gray-400">· {p}%</span>
            </span>
          </div>
        )
      })}
    </div>
  )
}

// One area's average: the number, coloured like the overall rating.
function AreaAvg({ a, lagging }) {
  if (!a || a.average == null) return <span className="text-gray-300">—</span>
  return (
    <span className={`font-semibold tabular-nums ${avgTone(a.average)} ${lagging ? 'underline decoration-rose-400 decoration-2 underline-offset-4' : ''}`}
      title={`${a.ratings} rating${a.ratings !== 1 ? 's' : ''}`}>
      {fmtAvg(a.average)}
    </span>
  )
}

// Overall card: one bar per area, out of 5, the lagging area marked.
function AreaBars({ areas, lagging, list }) {
  return (
    <div className="space-y-2">
      {list.map((c) => {
        const a = areas?.[c.key]
        const v = a?.average
        return (
          <div key={c.key} className="flex items-center gap-3 text-sm">
            <span className="w-36 font-medium text-gray-700">
              {c.label}
              {lagging?.key === c.key && <span className="ml-1 text-[10px] font-semibold px-1 py-0.5 rounded bg-rose-50 text-rose-700 ring-1 ring-rose-200">LAGGING</span>}
            </span>
            <div className="flex-1 h-3 rounded-full bg-gray-100 overflow-hidden">
              {v != null && <div className={`h-full rounded-full ${v >= 4.2 ? 'bg-emerald-500' : v >= 3.5 ? 'bg-amber-400' : 'bg-rose-500'}`} style={{ width: `${(v / 5) * 100}%` }} />}
            </div>
            <span className="w-24 text-right tabular-nums">
              <b className={avgTone(v)}>{fmtAvg(v)}</b> <span className="text-gray-400">· {a?.ratings || 0}</span>
            </span>
          </div>
        )
      })}
    </div>
  )
}

// An answer's stars: the overall, then each area as a small chip (low ones red).
function AnswerStars({ r, list }) {
  if (r.skipped) return <span className="text-xs text-gray-400 italic">Skipped</span>
  if (!r.rating) return <span className="text-xs text-gray-400">No stars</span>
  return (
    <div>
      <div className="flex items-center gap-1.5">
        <Stars value={r.rating} />
        <span className={`text-xs font-semibold tabular-nums ${avgTone(r.rating)}`}>{fmtAvg(r.rating)}</span>
      </div>
      {r.scores ? (
        <div className="flex flex-wrap gap-1 mt-1">
          {list.map((c) => {
            const v = r.scores[c.key]
            return (
              <span key={c.key} className={`text-[11px] px-1.5 py-0.5 rounded-md border tabular-nums ${STAR_PILL[v] || 'bg-gray-50 text-gray-500 border-gray-200'}`}>
                {c.label.split(' ')[0]} {v ?? '—'}★
              </span>
            )
          })}
        </div>
      ) : <p className="text-[11px] text-gray-400 mt-0.5">Overall only (older answer)</p>}
    </div>
  )
}

function saveCsv(lines, name) {
  // BOM so Excel reads the comments' non-English text correctly.
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}
const csv = (cells) => cells.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')

// Review state of a flagged answer (low rating, or comment without stars) —
// the same flag the Action Center queue shows. Mark it reviewed here or there.
function ReviewState({ row, onReviewed }) {
  const [noting, setNoting] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (row.review) {
    return (
      <p className="text-xs text-emerald-700 mt-1">
        ✓ Reviewed by {row.review.by || 'admin'} · {fmtWhen(row.review.doneAt)}
        {row.review.note && <span className="text-gray-600"> — {row.review.note}</span>}
      </p>
    )
  }
  if (!row.reviewReason) return null
  async function save() {
    setBusy(true); setError('')
    try {
      const d = await apiFetch(`/api/admin/class-feedback/${row._id}/review`, { method: 'POST', body: JSON.stringify({ done: true, note: note.trim() }) })
      onReviewed(row._id, d.review)
    } catch (e) {
      setError(e.message || 'Could not save')
      setBusy(false)
    }
  }
  return (
    <div className="mt-1.5">
      {!noting ? (
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 ring-1 ring-rose-200">Needs review</span>
          <button type="button" onClick={() => setNoting(true)} className="text-xs font-medium text-indigo-600 hover:text-indigo-800">Mark reviewed</button>
        </div>
      ) : (
        <div className="max-w-xl">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} autoFocus
            placeholder="What was done? (optional)"
            className="w-full text-sm rounded-lg border border-gray-200 px-3 py-1.5 outline-none focus:ring-2 focus:ring-indigo-400 resize-none" />
          {error && <p className="text-xs text-rose-600">{error}</p>}
          <div className="flex gap-2 mt-1">
            <button type="button" disabled={busy} onClick={() => { setNoting(false); setNote('') }}
              className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 text-gray-600">Cancel</button>
            <button type="button" disabled={busy} onClick={save}
              className="text-xs px-2.5 py-1 rounded-lg bg-indigo-600 text-white font-medium disabled:opacity-50">
              {busy ? 'Saving…' : 'Save — reviewed'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function ClassFeedbackPage() {
  // Opens on today — the admin checks the day's feedback first.
  const [from, setFrom] = useState(() => daysAgo(0))
  const [to, setTo] = useState(() => daysAgo(0))
  const [summary, setSummary] = useState({ key: null, data: null, error: '' })

  // Answer list filters.
  const [mentorId, setMentorId] = useState('')
  const [stars, setStars] = useState('')
  const [area, setArea] = useState('')
  const [commentsOnly, setCommentsOnly] = useState(false)
  const [showSkipped, setShowSkipped] = useState(false)
  const [needsReview, setNeedsReview] = useState(false)
  const [page, setPage] = useState(1)
  const [list, setList] = useState({ key: null, rows: [], total: 0, error: '' })
  const [exporting, setExporting] = useState(false)

  const rangeKey = `${from}|${to}`
  const listQuery = new URLSearchParams({
    from, to,
    ...(mentorId ? { mentorId } : {}),
    ...(stars ? { stars } : {}),
    ...(area ? { area } : {}),
    ...(commentsOnly ? { comments: '1' } : {}),
    ...(showSkipped ? { skipped: '1' } : {}),
    ...(needsReview ? { review: 'pending' } : {}),
  }).toString()
  const listKey = `${listQuery}|${page}`

  useEffect(() => {
    let alive = true
    apiFetch(`/api/admin/class-feedback/summary?from=${from}&to=${to}`)
      .then((d) => alive && setSummary({ key: `${from}|${to}`, data: d, error: '' }))
      .catch((e) => alive && setSummary({ key: `${from}|${to}`, data: null, error: e.message || 'Failed to load' }))
    return () => { alive = false }
  }, [from, to])

  useEffect(() => {
    let alive = true
    apiFetch(`/api/admin/class-feedback?${listQuery}&page=${page}&limit=${PAGE_SIZE}`)
      .then((d) => alive && setList({ key: `${listQuery}|${page}`, rows: d.rows || [], total: d.total || 0, error: '' }))
      .catch((e) => alive && setList({ key: `${listQuery}|${page}`, rows: [], total: 0, error: e.message || 'Failed to load' }))
    return () => { alive = false }
  }, [listQuery, page])

  // Any filter change starts the list again from page 1.
  const setFilter = (fn) => (v) => { fn(v); setPage(1) }

  const loading = summary.key !== rangeKey
  const listLoading = list.key !== listKey
  const o = summary.data?.overall
  const mentors = summary.data?.mentors || []
  const areaList = summary.data?.criteria || AREAS
  // Quality rank: only mentors with enough ratings for the average to mean something.
  let nextRank = 0
  const rankOf = new Map(mentors.filter((m) => m.ratings >= FEW_RATINGS).map((m) => [m.mentorId, ++nextRank]))
  const pages = Math.max(1, Math.ceil(list.total / PAGE_SIZE))

  async function exportCsv() {
    setExporting(true)
    try {
      const d = await apiFetch(`/api/admin/class-feedback?${listQuery}&export=1&limit=5000`)
      const lines = [csv(['Class date', 'Mentor', 'Class', 'Subject', 'Chapter', 'Student', 'Phone', 'Overall', ...areaList.map((c) => c.label), 'Comment', 'Skipped', 'Given on', 'Edited on', 'From', 'Review', 'Reviewed by', 'Review note'])]
      for (const r of d.rows || []) {
        lines.push(csv([fmtWhen(r.classStartedAt), r.mentorName, r.classTitle, r.subjectName, r.chapterName,
          r.studentName, r.studentPhone, r.rating ?? '', ...areaList.map((c) => r.scores?.[c.key] ?? ''), r.comment, r.skipped ? 'yes' : '',
          fmtWhen(r.createdAt), r.editedAt ? fmtWhen(r.editedAt) : '', r.source,
          r.review ? `Reviewed ${fmtWhen(r.review.doneAt)}` : r.reviewReason ? 'Needs review' : '',
          r.review?.by || '', r.review?.note || '']))
      }
      saveCsv(lines, `class-feedback-${from}-to-${to}.csv`)
    } catch (e) {
      alert(e.message || 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  const lowCount = o ? o.stars[1] + o.stars[2] : 0
  const tiles = o ? [
    { label: 'Overall rating', value: <span className={avgTone(o.average)}>{fmtAvg(o.average)}<span className="text-sm text-gray-400 font-normal"> / 5</span></span>,
      sub: <Stars value={o.average} />, ring: 'border-l-4 border-amber-400' },
    { label: 'Ratings', value: o.ratings, sub: `${o.answers} answers in all` },
    { label: 'Response rate', value: `${pct(o.answers, o.studentsJoined)}%`, sub: `${o.answers} of ${o.studentsJoined} who joined` },
    { label: 'Comments', value: o.comments, sub: `${o.skipped} skipped` },
    { label: 'Low ratings (1–2★)', value: <span className={lowCount ? 'text-rose-600' : ''}>{lowCount}</span>,
      sub: o.ratings ? `${pct(lowCount, o.ratings)}% of ratings` : '—', ring: lowCount ? 'border-l-4 border-rose-300' : '' },
    { label: 'Classes rated', value: `${o.classesRated} / ${o.classesHeld}`, sub: 'Ended classes in range' },
  ] : []

  const th = 'px-4 py-2.5 font-semibold whitespace-nowrap'

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Class Feedback</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            Students&apos; ratings on Conceptual clarity, Attention and Doubt solving, and their comments — overall and mentor by mentor.
          </p>
        </div>
        <div className="w-full flex flex-wrap items-center gap-1.5 order-last">
          {presets().map((p) => {
            const active = p.from === from && p.to === to
            return (
              <button key={p.label} type="button" onClick={() => { setFrom(p.from); setTo(p.to); setPage(1) }}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${active
                  ? 'bg-indigo-600 border-indigo-600 text-white'
                  : 'bg-white border-gray-200 text-gray-600 hover:border-indigo-300 hover:text-indigo-600'}`}>
                {p.label}
              </button>
            )
          })}
          <span className="text-xs text-gray-400 ml-2">
            Showing classes held {from === to ? `on ${fmtDate(from)}` : `${fmtDate(from)} – ${fmtDate(to)}`}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 ml-auto">
          <label className="text-xs text-gray-500">From</label>
          <input type="date" value={from} max={to} onChange={(e) => { if (e.target.value) { setFrom(e.target.value); setPage(1) } }} className={selectCls} />
          <label className="text-xs text-gray-500">To</label>
          <input type="date" value={to} min={from} max={daysAgo(0)} onChange={(e) => { if (e.target.value) { setTo(e.target.value); setPage(1) } }} className={selectCls} />
        </div>
      </div>

      {summary.error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-xl px-4 py-3">{summary.error}</div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {(loading ? Array.from({ length: 6 }, (_, i) => ({ label: '', value: '…', sub: '', key: i })) : tiles).map((t, i) => (
          <div key={t.label || i} className={`bg-white rounded-2xl shadow-sm px-4 py-3 ${t.ring || ''}`}>
            <p className="text-xs text-gray-400">{t.label || ' '}</p>
            <p className="text-2xl font-bold mt-1 tabular-nums text-gray-900">{t.value}</p>
            <div className="text-xs text-gray-400 mt-0.5">{t.sub}</div>
          </div>
        ))}
      </div>

      {!loading && o?.ratings > 0 && (
        <div className="bg-white rounded-2xl shadow-sm px-5 py-4 flex flex-col md:flex-row md:items-center gap-5">
          <div className="text-center md:w-44 md:border-r md:border-gray-100 md:pr-5">
            <p className={`text-4xl font-bold tabular-nums ${avgTone(o.average)}`}>{fmtAvg(o.average)}</p>
            <div className="mt-1 flex justify-center"><Stars value={o.average} size="w-5 h-5" /></div>
            <p className="text-sm text-gray-500 mt-1">{o.ratings} rating{o.ratings !== 1 ? 's' : ''}</p>
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-gray-700 mb-2">How students rated, overall</p>
            <StarHistogram stars={o.stars} total={o.ratings} />
          </div>
          <div className="flex-1 md:border-l md:border-gray-100 md:pl-5">
            <p className="text-sm font-semibold text-gray-700 mb-2">By area</p>
            <AreaBars areas={o.areas} lagging={o.lagging} list={areaList} />
            {o.lagging && <p className="text-xs text-rose-600 mt-2">Weakest area overall: <b>{o.lagging.label}</b></p>}
          </div>
        </div>
      )}

      {/* Mentor-wise */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <h2 className="text-sm font-bold text-gray-900">Mentor quality rating</h2>
          <p className="text-xs text-gray-400">
            Ranked by overall rating ({FEW_RATINGS}+ ratings to get a rank). &quot;Lagging in&quot; names the area holding a mentor back.
            Click a mentor to see their students&apos; answers below.
          </p>
        </div>
        {loading ? (
          <div className="p-10 text-center text-sm text-gray-400">Loading…</div>
        ) : !mentors.length ? (
          <div className="p-10 text-center text-sm text-gray-400">No live classes in this period.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-gray-100">
                  <th className={`${th} text-right`}>#</th>
                  <th className={`${th} text-left`}>Mentor</th>
                  <th className={`${th} text-left`}>Overall</th>
                  {areaList.map((c) => <th key={c.key} className={`${th} text-right`}>{c.label}</th>)}
                  <th className={`${th} text-left`}>Lagging in</th>
                  <th className={`${th} text-right`}>Ratings</th>
                  <th className={`${th} text-left`}>Star split</th>
                  <th className={`${th} text-right`}>Comments</th>
                  <th className={`${th} text-right`}>Response rate</th>
                  <th className={`${th} text-right`}>Classes rated</th>
                </tr>
              </thead>
              <tbody>
                {mentors.map((m) => {
                  const selected = mentorId === m.mentorId
                  return (
                    <tr key={m.mentorId}
                      onClick={() => setFilter(setMentorId)(selected ? '' : m.mentorId)}
                      className={`border-t border-gray-100 cursor-pointer ${selected ? 'bg-indigo-50' : 'hover:bg-indigo-50/40'}`}>
                      <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">{rankOf.get(m.mentorId) || '—'}</td>
                      <td className="px-4 py-2.5">
                        <p className="font-semibold text-gray-900">{m.name}</p>
                        <p className="text-xs text-gray-400">{m.phoneNumber}</p>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span className={`text-base font-bold tabular-nums ${avgTone(m.average)}`}>{fmtAvg(m.average)}</span>
                          <Stars value={m.average} />
                        </div>
                        {m.ratings > 0 && m.ratings < FEW_RATINGS && (
                          <p className="text-xs text-amber-600">Few ratings — read with care</p>
                        )}
                      </td>
                      {areaList.map((c) => (
                        <td key={c.key} className="px-4 py-2.5 text-right">
                          <AreaAvg a={m.areas?.[c.key]} lagging={m.lagging?.key === c.key} />
                        </td>
                      ))}
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {m.lagging
                          ? <span className="text-xs font-semibold px-1.5 py-0.5 rounded-md bg-rose-50 text-rose-700 ring-1 ring-rose-200">{m.lagging.label} · {fmtAvg(m.lagging.average)}</span>
                          : <span className="text-xs text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{m.ratings}</td>
                      <td className="px-4 py-2.5"><StarSplit stars={m.stars} total={m.ratings} /></td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{m.comments}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">
                        {pct(m.answers, m.studentsJoined)}%
                        <p className="text-xs text-gray-400">{m.answers} of {m.studentsJoined}</p>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {m.classesRated}<span className="text-gray-400"> / {m.classesHeld}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* The answers */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-bold text-gray-900 mr-auto">
            Student feedback {listLoading ? '' : <span className="font-normal text-gray-400">· {list.total}</span>}
          </h2>
          <select value={mentorId} onChange={(e) => setFilter(setMentorId)(e.target.value)} className={selectCls}>
            <option value="">All mentors</option>
            {mentors.map((m) => <option key={m.mentorId} value={m.mentorId}>{m.name}</option>)}
          </select>
          <select value={stars} onChange={(e) => setFilter(setStars)(e.target.value)} className={selectCls}>
            <option value="">Any rating</option>
            <option value="low">Low overall (under 2.5★)</option>
            {[5, 4, 3, 2, 1].map((s) => <option key={s} value={String(s)}>{s}★ overall</option>)}
          </select>
          <select value={area} onChange={(e) => setFilter(setArea)(e.target.value)} className={selectCls}>
            <option value="">Any area</option>
            {areaList.map((c) => <option key={c.key} value={c.key}>Low in {c.label} (1–2★)</option>)}
          </select>
          <label className="text-xs text-gray-600 flex items-center gap-1.5">
            <input type="checkbox" checked={commentsOnly} onChange={(e) => setFilter(setCommentsOnly)(e.target.checked)} />
            With comment
          </label>
          <label className="text-xs text-gray-600 flex items-center gap-1.5">
            <input type="checkbox" checked={needsReview} onChange={(e) => setFilter(setNeedsReview)(e.target.checked)} />
            Needs review
          </label>
          <label className="text-xs text-gray-600 flex items-center gap-1.5">
            <input type="checkbox" checked={showSkipped} onChange={(e) => setFilter(setShowSkipped)(e.target.checked)} />
            Show skipped
          </label>
          <button type="button" onClick={exportCsv} disabled={exporting || listLoading || !list.total}
            className="text-sm px-3 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-40">
            {exporting ? 'Exporting…' : 'Download CSV'}
          </button>
        </div>

        {list.error && <div className="m-4 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-xl px-4 py-3">{list.error}</div>}

        {listLoading ? (
          <div className="p-10 text-center text-sm text-gray-400">Loading…</div>
        ) : !list.rows.length ? (
          <div className="p-10 text-center text-sm text-gray-400">No feedback matches these filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-gray-100 text-left">
                  <th className={th}>Class</th>
                  <th className={th}>Mentor</th>
                  <th className={th}>Student</th>
                  <th className={th}>Rating</th>
                  <th className={`${th} w-full`}>Comment</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((r) => (
                  <tr key={r._id} className="border-t border-gray-100 align-top">
                    <td className="px-4 py-2.5 min-w-[12rem]">
                      <p className="font-medium text-gray-800">{r.classTitle}</p>
                      <p className="text-xs text-gray-500">{fmtWhen(r.classStartedAt)}</p>
                      {(r.subjectName || r.chapterName) && (
                        <p className="text-xs text-indigo-500">{[r.subjectName, r.chapterName].filter(Boolean).join(' · ')}</p>
                      )}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-gray-700">{r.mentorName}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <p className="text-gray-800">{r.studentName || '—'}</p>
                      <p className="text-xs text-gray-400">{r.studentPhone}</p>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <AnswerStars r={r} list={areaList} />
                    </td>
                    <td className="px-4 py-2.5">
                      {r.comment
                        ? <p className="text-gray-800 whitespace-pre-wrap break-words max-w-xl">{r.comment}</p>
                        : <span className="text-xs text-gray-300">—</span>}
                      <p className="text-xs text-gray-400 mt-0.5">
                        Given {fmtWhen(r.createdAt)}{r.editedAt ? ` · edited ${fmtWhen(r.editedAt)}` : ''}{r.source !== 'web' ? ` · ${r.source}` : ''}
                      </p>
                      <ReviewState row={r} onReviewed={(id, review) =>
                        setList((l) => ({ ...l, rows: l.rows.map((x) => (x._id === id ? { ...x, review } : x)) }))} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pages > 1 && !listLoading && (
          <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-100 text-sm">
            <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
              className="px-3 py-1.5 rounded-lg border border-gray-200 disabled:opacity-40">‹ Prev</button>
            <span className="text-gray-500 tabular-nums">Page {page} of {pages}</span>
            <button type="button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1.5 rounded-lg border border-gray-200 disabled:opacity-40">Next ›</button>
          </div>
        )}
      </div>

      <div className="text-xs text-gray-500 space-y-0.5">
        <p><b>Who can answer</b> — only students who joined the class, once it has ended, for {summary.data?.windowDays || 7} days after. Stars and comment are both optional, but stars are given for all three areas together; a student can change their answer inside that time.</p>
        <p><b>Overall</b> — each answer&apos;s overall is the average of its three areas; the mentor&apos;s overall is the average of those (older single-star answers count here too). Comment-only answers and skips are not counted. &quot;Few ratings&quot; marks fewer than {FEW_RATINGS}.</p>
        <p><b>Area averages</b> — {areaList.map((c) => c.label).join(', ')}, each averaged over the answers that scored it. <b>Lagging in</b> — the mentor&apos;s lowest area, shown when it is under 3.5★ or 0.5★+ below their best area (3+ scores needed).</p>
        <p><b>Response rate</b> — answers (stars and/or comment) ÷ students who joined that mentor&apos;s ended classes. Skips are not answers.</p>
        <p className="text-gray-400">Classes are placed by their scheduled date. Students are told only the FOCAS team sees their feedback — please don&apos;t share names with mentors.</p>
      </div>
    </div>
  )
}
