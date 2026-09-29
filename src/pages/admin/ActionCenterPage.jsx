import { useState, useEffect, useCallback } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { apiFetch } from '../../api'

// Admin home screen — "what needs my attention today", not another spreadsheet.
// Every number is a count of things someone has to act on; a click opens the
// students / papers / classes behind it in a side panel.

// ── Helpers ──────────────────────────────────────────────────────────────────

function ago(d) {
  if (!d) return ''
  const ms = Date.now() - new Date(d).getTime()
  const future = ms < 0
  const m = Math.round(Math.abs(ms) / 60000)
  const txt = m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`
  return future ? `in ${txt}` : `${txt} ago`
}

const timeOf = d => new Date(d).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })

const TONE = {
  good:  { bar: 'bg-emerald-500', text: 'text-emerald-700' },
  watch: { bar: 'bg-amber-500',   text: 'text-amber-700' },
  bad:   { bar: 'bg-red-500',     text: 'text-red-700' },
  none:  { bar: 'bg-gray-300',    text: 'text-gray-400' },
}

const QUICK_VIEWS = [
  { to: '/admin/users',            label: 'Students' },
  { to: '/admin/live-classes',     label: 'Schedule' },
  { to: '/admin/test-series',      label: 'Tests' },
  { to: '/admin/chapter-progress', label: 'Chapter Progress' },
  { to: '/admin/purchases',        label: 'Payments' },
  { to: '/admin/sales',            label: 'Sales' },
  { to: '/admin/products',         label: 'Products' },
  { to: '/admin/content',          label: 'Content' },
]

function SectionTitle({ children, className = 'text-gray-500' }) {
  return <h2 className={`text-xs font-bold uppercase tracking-wide mb-2.5 ${className}`}>{children}</h2>
}

// ── Today strip ──────────────────────────────────────────────────────────────

function TodayTile({ value, label, alert, onClick }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag onClick={onClick}
      className={`bg-white rounded-2xl px-4 py-3.5 shadow-sm text-left ${onClick ? 'hover:ring-2 hover:ring-indigo-200 transition' : ''}`}>
      <p className={`text-2xl font-bold ${alert ? 'text-red-600' : 'text-gray-900'}`}>{value ?? '—'}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
    </Tag>
  )
}

// ── Action queue card ────────────────────────────────────────────────────────

function QueueCard({ card, onOpen }) {
  const clear = card.count === 0
  return (
    <button onClick={() => onOpen(card.key)}
      className={`group bg-white rounded-2xl p-4 shadow-sm border-2 text-left transition hover:shadow-md ${
        clear ? 'border-transparent' : 'border-red-200 hover:border-red-400'
      }`}>
      <div className="flex items-start justify-between gap-2">
        <p className={`text-3xl font-bold leading-none ${clear ? 'text-emerald-600' : 'text-red-600'}`}>
          {clear ? '✓' : card.count}
        </p>
        <span className="text-gray-300 group-hover:text-gray-500 text-lg leading-none">→</span>
      </div>
      <p className="text-sm font-semibold text-gray-900 mt-2">{card.title}</p>
      <p className="text-xs text-gray-400 mt-1 leading-snug">{clear ? 'Nothing waiting' : card.hint}</p>
    </button>
  )
}

// ── Drill-down drawer ────────────────────────────────────────────────────────

function ItemRow({ item, busy, onAction, onOpenLink }) {
  return (
    <li className="px-5 py-3.5 border-b border-gray-100">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">
            {item.name}
            {item.phone && <span className="ml-2 text-xs font-normal text-gray-400">{item.phone}</span>}
          </p>
          <p className="text-sm text-gray-700 mt-0.5">{item.title}</p>
          {item.detail && <p className="text-xs text-gray-400 mt-0.5">{item.detail}</p>}
          {item.at && (
            <p className="text-[11px] text-gray-400 mt-1">
              {item.ageLabel ? `${item.ageLabel} ` : ''}{ago(item.at)}
              {item.overdue && <span className="ml-2 px-1.5 py-0.5 rounded bg-red-50 text-red-600 font-medium">overdue</span>}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          {item.link && (
            <button onClick={() => onOpenLink(item.link)}
              className="text-xs font-medium text-indigo-600 hover:text-indigo-800">Open →</button>
          )}
          {(item.actions || []).includes('mark-scheduled') && (
            <button disabled={busy} onClick={() => onAction(item, 'mark-scheduled')}
              className="text-xs font-medium px-2.5 py-1 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
              {busy ? 'Saving…' : 'Mark scheduled'}
            </button>
          )}
          {(item.actions || []).includes('mark-followed-up') && (
            <button disabled={busy} onClick={() => onAction(item, 'mark-followed-up')}
              className="text-xs font-medium px-2.5 py-1 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
              {busy ? 'Saving…' : 'Mark followed up'}
            </button>
          )}
        </div>
      </div>
    </li>
  )
}

function Drawer({ listKey, onClose, onChanged }) {
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [busyId, setBusyId] = useState(null)

  useEffect(() => {
    let alive = true
    apiFetch(`/api/admin/action-center/list/${listKey}`)
      .then(d => { if (alive) setData(d) })
      .catch(e => { if (alive) setError(e.message) })
    return () => { alive = false }
  }, [listKey])

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function act(item, action) {
    setBusyId(item.id)
    setError('')
    try {
      if (action === 'mark-scheduled') {
        await apiFetch(`/api/admin/purchases/${item.id}/scheduled`, { method: 'PATCH', body: JSON.stringify({ scheduled: true }) })
      } else if (action === 'mark-followed-up') {
        await apiFetch(`/api/admin/action-center/tests/${item.id}/follow-up`, { method: 'POST', body: JSON.stringify({ done: true }) })
      }
      setData(d => ({ ...d, total: d.total - 1, items: d.items.filter(i => i.id !== item.id) }))
      onChanged()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusyId(null)
    }
  }

  const needle = q.trim().toLowerCase()
  const items = (data?.items || []).filter(i => !needle ||
    [i.name, i.phone, i.title, i.detail].some(v => v && String(v).toLowerCase().includes(needle)))

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <aside className="relative w-full max-w-xl h-full bg-white shadow-xl flex flex-col">
        <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-semibold text-gray-900">{data?.title || 'Loading…'}</h3>
            {data?.hint && <p className="text-xs text-gray-400 mt-0.5">{data.hint}</p>}
          </div>
          <button onClick={onClose} aria-label="Close"
            className="text-gray-400 hover:text-gray-700 text-xl leading-none px-1">×</button>
        </div>

        {data && data.total > 0 && (
          <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-3">
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, phone, class…"
              className="flex-1 text-sm rounded-lg border border-gray-200 px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            <span className="text-xs text-gray-400 whitespace-nowrap">
              {items.length}{data.total > data.items.length ? ` of ${data.total}` : ''} shown
            </span>
          </div>
        )}

        {error && <p className="mx-5 mt-3 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        <div className="flex-1 overflow-y-auto">
          {!data && !error && (
            <div className="p-5 space-y-3">
              {[1, 2, 3, 4].map(i => <div key={i} className="h-14 bg-gray-50 rounded-xl animate-pulse" />)}
            </div>
          )}
          {data && data.total === 0 && (
            <p className="px-5 py-12 text-center text-sm text-gray-400">Nothing here — all clear.</p>
          )}
          {data && data.total > 0 && items.length === 0 && (
            <p className="px-5 py-12 text-center text-sm text-gray-400">No match for “{q}”.</p>
          )}
          <ul>
            {items.map(item => (
              <ItemRow key={item.id} item={item} busy={busyId === item.id}
                onAction={act} onOpenLink={to => navigate(to)} />
            ))}
          </ul>
        </div>
      </aside>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ActionCenterPage() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(null)   // list key shown in the drawer

  const load = useCallback((fresh = false) =>
    apiFetch(`/api/admin/action-center${fresh ? '?fresh=1' : ''}`)
      .then(d => { setData(d); setError('') })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  , [])

  const refresh = () => { setLoading(true); load(true) }

  useEffect(() => { load() }, [load])

  // Counts go stale while the admin works; refresh them when they come back to the tab.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [load])

  const closeDrawer = useCallback(() => setOpen(null), [])
  const t = data?.today
  const attentionTotal = (data?.queue || []).reduce((s, c) => s + c.count, 0)

  return (
    <div className="p-6 space-y-7 max-w-7xl">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Action Center</h1>
          <p className="text-gray-400 text-sm mt-0.5">
            {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            {data && <> · {attentionTotal === 0 ? 'nothing waiting on you' : `${attentionTotal} items need action`}</>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {data && <span className="text-xs text-gray-400">Updated {timeOf(data.generatedAt)}</span>}
          <button onClick={refresh} disabled={loading}
            className="text-sm font-medium px-3 py-1.5 rounded-lg bg-white shadow-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3">Couldn't load the Action Center: {error}</p>}

      {!data && !error && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-28 bg-white rounded-2xl shadow-sm animate-pulse" />)}
        </div>
      )}

      {data && (
        <>
          {/* 1. Today */}
          <section>
            <SectionTitle>Today</SectionTitle>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <TodayTile value={t.liveNow} label="Live sessions now" />
              <TodayTile value={t.attendanceToday.percent == null ? '—' : `${t.attendanceToday.percent}%`}
                label={t.attendanceToday.seats ? `Attendance today · ${t.attendanceToday.seats} seats` : 'Attendance today · no classes ended yet'} />
              <TodayTile value={t.tutorAlerts} label="Tutor alerts open" alert={t.tutorAlerts > 0}
                onClick={() => setOpen('tutorAlerts')} />
              <TodayTile value={t.sessionsOverdue} label="Sessions overdue" alert={t.sessionsOverdue > 0}
                onClick={() => setOpen('sessionsOverdue')} />
            </div>
          </section>

          {/* 2. Action queue */}
          <section>
            <SectionTitle className="text-red-600">🔴 Action queue — needs admin action today</SectionTitle>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
              {data.queue.map(card => <QueueCard key={card.key} card={card} onOpen={setOpen} />)}
            </div>
          </section>

          {/* 3. Exceptions */}
          <section>
            <SectionTitle className="text-amber-600">🟡 Exceptions — trending toward a problem</SectionTitle>
            <div className="bg-white rounded-2xl shadow-sm divide-y divide-gray-100 overflow-hidden">
              {data.exceptions.map(row => (
                <button key={row.key} onClick={() => setOpen(row.key)} title={row.hint}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors">
                  <span className="flex items-center gap-2.5 min-w-0">
                    <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${row.count ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                    <span className="text-sm text-gray-800">{row.title}</span>
                  </span>
                  <span className="flex items-center gap-3 flex-shrink-0">
                    <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${
                      row.count ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-300' : 'bg-gray-50 text-gray-400'
                    }`}>{row.count}</span>
                    <span className="text-gray-300">→</span>
                  </span>
                </button>
              ))}
            </div>
          </section>

          {/* 4. Health */}
          <section>
            <SectionTitle className="text-emerald-600">🟢 Health — is the system okay overall</SectionTitle>
            <div className="bg-white rounded-2xl shadow-sm p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-5">
              {data.health.map(h => {
                const tone = TONE[h.tone] || TONE.none
                return (
                  <div key={h.key} title={h.detail}>
                    <div className="flex items-baseline justify-between mb-1.5">
                      <span className="text-xs text-gray-500">{h.label}</span>
                      <span className={`text-sm font-bold ${tone.text}`}>{h.percent == null ? '—' : `${h.percent}%`}</span>
                    </div>
                    <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                      <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${h.percent ?? 0}%` }} />
                    </div>
                    <p className="text-[11px] text-gray-400 mt-1.5">{h.detail}</p>
                  </div>
                )
              })}
            </div>
          </section>

          {/* 5. Quick views */}
          <section>
            <SectionTitle>📊 Quick views</SectionTitle>
            <div className="flex flex-wrap gap-2">
              {QUICK_VIEWS.map(v => (
                <Link key={v.to} to={v.to}
                  className="text-xs font-medium px-3.5 py-1.5 rounded-full bg-white shadow-sm text-gray-600 hover:bg-indigo-50 hover:text-indigo-700">
                  {v.label}
                </Link>
              ))}
            </div>
          </section>
        </>
      )}

      {open && <Drawer listKey={open} onClose={closeDrawer} onChanged={() => load(true)} />}
    </div>
  )
}
