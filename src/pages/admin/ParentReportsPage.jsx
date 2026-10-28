// Parent Reports — the weekly and monthly WhatsApp progress report to the
// parents of Foundation students (school children). Per period this page lists
// every Foundation student with the numbers their parent gets (classes
// attended, class work handed in, overall attendance, syllabus done), whether
// it went out, and lets the admin fill in parent numbers, preview a message,
// send / resend, and change the schedule.
// Data: /api/admin/parent-reports (server/controllers/parentReportController.js).
import { useState, useEffect, useCallback, useMemo } from 'react'
import { apiFetch } from '../../api'
import ParentContactModal from '../../components/ParentContactModal'
import { reportMessage, showPhone } from '../../lib/parentReport'

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const fmtStamp = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '')

// 'YYYY-MM-DD' ± days / 'YYYY-MM' ± months, calendar maths only (no time zone).
const shiftDay = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
const shiftMonth = (ym, n) => {
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7)
}

const btn = {
  primary: 'inline-flex items-center justify-center gap-1.5 text-sm px-3.5 py-2 rounded-lg bg-indigo-600 text-white font-medium shadow-sm hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed',
  secondary: 'inline-flex items-center justify-center gap-1.5 text-sm px-3.5 py-2 rounded-lg bg-white border border-gray-200 text-gray-700 font-medium hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed',
  small: 'inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border font-medium disabled:opacity-40 disabled:cursor-not-allowed',
}
const fieldCls = 'text-sm px-3 py-2 bg-white border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400'

// Every row lands in exactly one of these. Order = sort order (needs action first).
const STATES = {
  failed:    { label: 'Send failed', chip: 'bg-rose-50 text-rose-700 ring-rose-200' },
  nonumber:  { label: 'No number',   chip: 'bg-amber-50 text-amber-700 ring-amber-200' },
  ready:     { label: 'Ready',       chip: 'bg-indigo-50 text-indigo-700 ring-indigo-200' },
  sending:   { label: 'Sending…',    chip: 'bg-sky-50 text-sky-700 ring-sky-200' },
  sent:      { label: 'Sent',        chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  noclasses: { label: 'No classes',  chip: 'bg-gray-100 text-gray-500 ring-gray-200' },
  off:       { label: 'Turned off',  chip: 'bg-gray-100 text-gray-500 ring-gray-200' },
  other:     { label: 'Skipped',     chip: 'bg-gray-100 text-gray-500 ring-gray-200' },
}
const ORDER = Object.keys(STATES)

function stateOf(row) {
  const r = row.report
  if (r) return r.status === 'sent' ? 'sent' : r.status === 'sending' ? 'sending' : 'failed'
  const s = row.status || ''
  if (s === 'would send' || s === 'would retry') return 'ready'
  if (s.includes('no parent WhatsApp number')) return 'nonumber'
  if (s.includes('switched off')) return 'off'
  if (s.includes('no classes')) return 'noclasses'
  return 'other'
}

function statusLine(row, state) {
  const r = row.report
  switch (state) {
    case 'sent': return `${fmtStamp(r.sentAt)}${r.sentTo && r.sentTo !== r.parentPhone ? ` · test → ${showPhone(r.sentTo)}` : ''}`
    case 'failed': return r.lastError || 'WhatsApp did not accept the message'
    case 'sending': return 'In progress'
    case 'ready': return 'Goes out on the next run'
    case 'nonumber': return 'Add the parent number'
    case 'off': return 'Reports off for this student'
    case 'noclasses': return 'Nothing to report this period'
    default: return (row.status || '').replace(/^skipped: /, '')
  }
}

function Chip({ state }) {
  const s = STATES[state]
  return <span className={`inline-flex text-[11px] font-semibold px-2 py-0.5 rounded-full ring-1 ${s.chip}`}>{s.label}</span>
}

function Modal({ title, subtitle, onClose, children, footer, width = 'max-w-lg' }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/40" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()}
        className={`w-full ${width} max-h-[88vh] flex flex-col bg-white rounded-2xl shadow-2xl`}>
        <div className="flex items-start gap-3 px-5 pt-4 pb-3 border-b border-gray-100">
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold text-gray-900 truncate">{title}</h3>
            {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="ml-auto -mr-1 w-8 h-8 inline-flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100">✕</button>
        </div>
        <div className="px-5 py-4 overflow-y-auto">{children}</div>
        {footer && <div className="flex items-center gap-2 px-5 py-3 border-t border-gray-100 bg-gray-50/60 rounded-b-2xl">{footer}</div>}
      </div>
    </div>
  )
}

// ───────────────────────────── settings ─────────────────────────────

function SettingsModal({ config, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({
    weekly:  { enabled: config.weekly.autoEnabled,  weekday: config.weekly.weekday, time: config.weekly.time },
    monthly: { enabled: config.monthly.autoEnabled, day: config.monthly.day,        time: config.monthly.time },
    contact: config.contact || '',
    testPhone: config.testPhone || '',
  }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (kind, key, value) => setForm(f => ({ ...f, [kind]: { ...f[kind], [key]: value } }))

  async function save() {
    setSaving(true); setError('')
    try {
      const d = await apiFetch('/api/admin/parent-reports/settings', {
        method: 'PUT',
        body: JSON.stringify({ weekly: form.weekly, monthly: form.monthly, contact: form.contact, testPhone: form.testPhone }),
      })
      onSaved(d.config)
      onClose()
    } catch (e) {
      setError(e.message)
      setSaving(false)
    }
  }

  const section = (kind, title, children) => (
    <div className="rounded-xl border border-gray-200 p-3.5 space-y-3">
      <label className="flex items-center gap-2.5 cursor-pointer">
        <input type="checkbox" checked={form[kind].enabled} onChange={e => set(kind, 'enabled', e.target.checked)} className="w-4 h-4 accent-indigo-600" />
        <span className="text-sm font-semibold text-gray-800">{title}</span>
        <span className="text-[11px] text-gray-400">{form[kind].enabled ? 'sends automatically' : 'off — only manual Send'}</span>
      </label>
      {children}
    </div>
  )

  return (
    <Modal title="Parent report settings" subtitle="Times are India time. Changes apply at once." onClose={onClose} width="max-w-md"
      footer={(
        <>
          {error && <p className="text-xs text-rose-600 mr-auto">{error}</p>}
          <button type="button" onClick={onClose} className={`ml-auto ${btn.secondary}`}>Cancel</button>
          <button type="button" onClick={save} disabled={saving} className={btn.primary}>{saving ? 'Saving…' : 'Save'}</button>
        </>
      )}>
      <div className="space-y-4">
        {section('weekly', 'Weekly report', <>
          <div className="flex gap-2">
            <select value={form.weekly.weekday} onChange={e => set('weekly', 'weekday', Number(e.target.value))} className={`flex-1 ${fieldCls}`}>
              {WEEKDAYS.map((d, i) => <option key={d} value={i}>Every {d}</option>)}
            </select>
            <input type="time" value={form.weekly.time} onChange={e => set('weekly', 'time', e.target.value)} className={fieldCls} />
          </div>
          <p className="text-[11px] text-gray-400">Covers the 7 days before the send day.</p>
        </>)}
        {section('monthly', 'Monthly report', <>
          <div className="flex gap-2 items-center">
            <span className="text-sm text-gray-600">Day</span>
            <input type="number" min={1} max={28} value={form.monthly.day} onChange={e => set('monthly', 'day', Number(e.target.value))} className={`w-20 ${fieldCls}`} />
            <span className="text-sm text-gray-600">of the month at</span>
            <input type="time" value={form.monthly.time} onChange={e => set('monthly', 'time', e.target.value)} className={fieldCls} />
          </div>
          <p className="text-[11px] text-gray-400">Covers the whole previous month.</p>
        </>)}
        <label className="block">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Contact number for parents</span>
          <input value={form.contact} onChange={e => setForm(f => ({ ...f, contact: e.target.value }))} maxLength={60} placeholder="93615 37780"
            className={`mt-1 w-full ${fieldCls}`} />
          <span className="block text-[11px] text-gray-400 mt-1">Last line of the message: "please call or WhatsApp us at …". Empty = 93615 37780.</span>
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Test phone</span>
          <input value={form.testPhone} onChange={e => setForm(f => ({ ...f, testPhone: e.target.value }))} placeholder="Empty = real parents"
            className={`mt-1 w-full ${fieldCls}`} />
          <span className="block text-[11px] text-gray-400 mt-1">When set, EVERY report goes to this number instead of the parents — use it to check the message first.</span>
        </label>
      </div>
    </Modal>
  )
}

// ───────────────────────────── the page ─────────────────────────────

// Per-student on/off for the parent reports (User.parent.reportsOff).
function Switch({ on, busy, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} title={label} disabled={busy} onClick={() => onChange(!on)}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${on ? 'bg-emerald-500' : 'bg-gray-300'}`}>
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  )
}

function Stat({ a, b, pct, sub }) {
  return (
    <div className="leading-tight">
      <span className="text-sm font-semibold text-gray-800">{a}</span>
      {b !== undefined && <span className="text-xs text-gray-400"> / {b}</span>}
      {pct !== undefined && <span className="text-xs text-gray-500"> · {pct}%</span>}
      {sub && <div className="text-[11px] text-gray-400">{sub}</div>}
    </div>
  )
}

export default function ParentReportsPage() {
  const [kind, setKind] = useState('weekly')
  const [period, setPeriod] = useState('')       // '' = latest finished
  const [data, setData] = useState(null)         // null = loading
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [show, setShow] = useState('all')        // all | nonumber | failed
  const [busy, setBusy] = useState('')           // row id / 'all' while sending
  const [toast, setToast] = useState(null)
  const [contactRow, setContactRow] = useState(null)
  const [previewRow, setPreviewRow] = useState(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // Bumped to reload the current period. A response for a period the admin
  // has already moved away from is dropped (`alive`).
  const [reloadKey, setReloadKey] = useState(0)
  const load = useCallback(() => setReloadKey(k => k + 1), [])
  useEffect(() => {
    let alive = true
    apiFetch(`/api/admin/parent-reports?kind=${kind}${period ? `&period=${period}` : ''}`)
      .then(d => {
        if (!alive) return
        setError('')
        setData(d)
        if (!period) setPeriod(d.period)
      })
      .catch(e => {
        if (!alive) return
        setError(e.message)
        setData(d => d || { rows: [] })
      })
    return () => { alive = false }
  }, [kind, period, reloadKey])

  useEffect(() => {
    if (!toast) return undefined
    const t = setTimeout(() => setToast(null), toast.error ? 8000 : 4000)
    return () => clearTimeout(t)
  }, [toast])

  const switchKind = (k) => { if (k !== kind) { setKind(k); setPeriod(''); setData(null) } }
  const step = (n) => { setData(null); setPeriod(p => (kind === 'weekly' ? shiftDay(p, 7 * n) : shiftMonth(p, n))) }

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (data?.rows || [])
      .map(r => ({ ...r, state: stateOf(r) }))
      .filter(r => show === 'all' || r.state === show)
      .filter(r => !q || [r.name, r.phone, r.parentName, r.parentPhone].some(v => (v || '').toLowerCase().includes(q)))
      .sort((a, b) => ORDER.indexOf(a.state) - ORDER.indexOf(b.state) || (a.name || '').localeCompare(b.name || ''))
  }, [data, search, show])

  const counts = useMemo(() => {
    const c = {}
    for (const r of data?.rows || []) { const s = stateOf(r); c[s] = (c[s] || 0) + 1 }
    return c
  }, [data])

  const cfg = data?.config
  const kindCfg = cfg?.[kind]
  const sendBlock = data?.periodBlocked || kindCfg?.blocker || ''
  const toSend = (counts.ready || 0) + (counts.failed || 0)

  // Reset: the automatic run may fire again for this period. Test sends and
  // failed reports are removed; reports really delivered to parents are kept.
  async function reset() {
    if (!window.confirm(`Reset the ${kind} report for ${data.periodLabel}?\n\n`
      + '• The automatic run will send it again (within 5 minutes if its send time has passed, otherwise at the send time).\n'
      + '• Test sends and failed reports of this period are cleared.\n'
      + '• Reports already delivered to parents are kept — no parent gets it twice.')) return
    setBusy('reset')
    try {
      const r = await apiFetch('/api/admin/parent-reports/reset', { method: 'POST', body: JSON.stringify({ kind, period }) })
      setToast({ text: `Reset done — ${r.removed} cleared, ${r.kept} delivered kept` })
    } catch (e) {
      setToast({ error: true, text: e.message })
    } finally {
      setBusy('')
      load()
    }
  }

  // Row switch: reports on / off for this one student.
  async function toggleReports(row, on) {
    setBusy(`switch:${row.studentId}`)
    try {
      await apiFetch(`/api/admin/users/${row.studentId}/parent`, { method: 'PUT', body: JSON.stringify({ reportsOff: !on }) })
      setToast({ text: `Reports ${on ? 'on' : 'off'} for ${row.name || 'this student'}` })
    } catch (e) {
      setToast({ error: true, text: e.message })
    } finally {
      setBusy('')
      load()
    }
  }

  async function send(row) {
    const label = row ? `${row.name}'s parent` : `${toSend} parent${toSend === 1 ? '' : 's'}`
    const test = cfg?.testPhone ? `\n\nTEST MODE: it goes to ${showPhone(cfg.testPhone)}, not the parent.` : ''
    if (!window.confirm(`Send the ${kind} report for ${data.periodLabel} to ${label} on WhatsApp now?${test}`)) return
    setBusy(row ? row.studentId : 'all')
    try {
      const d = row?.report && row.report.status !== 'failed'
        ? await apiFetch(`/api/admin/parent-reports/${row.report.id}/resend`, { method: 'POST' }).then(r => ({ summary: { sent: r.result === 'sent' ? 1 : 0, failed: r.result === 'sent' ? 0 : 1 } }))
        : await apiFetch('/api/admin/parent-reports/run', { method: 'POST', body: JSON.stringify({ kind, period, ...(row ? { studentId: row.studentId } : {}) }) })
      const s = d.summary
      setToast(s.failed ? { error: true, text: `${s.sent} sent, ${s.failed} failed — see the red rows` } : { text: `${s.sent} report${s.sent === 1 ? '' : 's'} sent` })
    } catch (e) {
      setToast({ error: true, text: e.message })
    } finally {
      setBusy('')
      load()
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-[1400px] mx-auto">
      <div className="flex flex-wrap items-start gap-3 mb-4">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-gray-900">Parent Reports</h1>
          <p className="text-sm text-gray-500 mt-0.5">WhatsApp progress report to parents of Foundation students — attendance, class work and syllabus progress.</p>
        </div>
        <button type="button" onClick={() => setSettingsOpen(true)} disabled={!cfg} className={`ml-auto ${btn.secondary}`}>⚙ Settings</button>
      </div>

      {/* Kind + period */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
          {['weekly', 'monthly'].map(k => (
            <button key={k} type="button" onClick={() => switchKind(k)}
              className={`px-3.5 py-1.5 text-sm rounded-md font-medium capitalize ${kind === k ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>{k}</button>
          ))}
        </div>
        <div className="inline-flex items-center gap-1">
          <button type="button" onClick={() => step(-1)} disabled={!period} className={btn.secondary} aria-label="Previous">‹</button>
          {kind === 'weekly' ? (
            <input type="date" value={period} onChange={e => { if (e.target.value) { setData(null); setPeriod(e.target.value) } }} className={fieldCls} title="Week starting" />
          ) : (
            <input type="month" value={period} onChange={e => { if (e.target.value) { setData(null); setPeriod(e.target.value) } }} className={fieldCls} />
          )}
          <button type="button" onClick={() => step(1)} disabled={!period} className={btn.secondary} aria-label="Next">›</button>
        </div>
        {data?.periodLabel && <span className="text-sm font-semibold text-gray-700">{data.periodLabel}</span>}
        <button type="button" onClick={reset} disabled={!data || !period || !!busy}
          title="Let the automatic run send this period again (delivered reports are kept)"
          className={`ml-auto ${btn.secondary}`}>
          {busy === 'reset' ? 'Resetting…' : '↺ Reset'}
        </button>
        <button type="button" onClick={() => send(null)} disabled={!data || !!sendBlock || !toSend || !!busy}
          title={sendBlock || (!toSend ? 'Nothing waiting to be sent for this period' : '')}
          className={btn.primary}>
          {busy === 'all' ? 'Sending…' : `Send ${toSend || ''} not sent`}
        </button>
      </div>

      {/* What the server will and won't do */}
      {cfg && (
        <div className="space-y-2 mb-3">
          {!cfg.jobEnabled && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Sending is off on this server (PARENT_REPORT_JOB is not 1). You can fill in numbers and preview; nothing goes to WhatsApp from here.
            </p>
          )}
          {cfg.testPhone && (
            <p className="text-xs text-sky-800 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2">
              Test mode: every report goes to <b>{showPhone(cfg.testPhone)}</b>, not to parents. Clear the test phone in Settings to go live.
            </p>
          )}
          <p className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
            {kindCfg.autoEnabled
              ? <>Automatic {kind} report is <b>on</b> — {kindCfg.schedule}. Next: {fmtStamp(kindCfg.nextRunAt)}.</>
              : <>Automatic {kind} report is <b>off</b>. Switch it on in Settings once a preview looks right.</>}
            {kindCfg.lastRunSummary && kindCfg.lastPeriod && (
              <> Last run ({kindCfg.lastPeriod}): {kindCfg.lastRunSummary.sent} sent, {kindCfg.lastRunSummary.failed} failed, {kindCfg.lastRunSummary.skipped} skipped.</>
            )}
          </p>
          {data?.periodBlocked && (
            <p className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">{data.periodBlocked} — numbers below are so far.</p>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {[['all', `All ${data?.rows?.length ?? ''}`], ['nonumber', `No number ${counts.nonumber || 0}`], ['failed', `Failed ${counts.failed || 0}`], ['ready', `Ready ${counts.ready || 0}`], ['sent', `Sent ${counts.sent || 0}`]].map(([k, label]) => (
          <button key={k} type="button" onClick={() => setShow(k)}
            className={`text-xs px-3 py-1.5 rounded-full border font-medium ${show === k ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>{label}</button>
        ))}
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search student or parent…" className={`ml-auto w-full sm:w-64 ${fieldCls}`} />
      </div>

      {error && <p className="text-sm text-rose-600 mb-3">{error}</p>}

      <div className="bg-white border border-gray-200 rounded-2xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 bg-gray-50 border-b border-gray-200">
              <th className="px-4 py-2.5 font-semibold">Student</th>
              <th className="px-4 py-2.5 font-semibold">Parent</th>
              <th className="px-4 py-2.5 font-semibold">Reports</th>
              <th className="px-4 py-2.5 font-semibold">Classes attended</th>
              <th className="px-4 py-2.5 font-semibold">Class work</th>
              <th className="px-4 py-2.5 font-semibold">Overall attendance</th>
              <th className="px-4 py-2.5 font-semibold">Syllabus</th>
              <th className="px-4 py-2.5 font-semibold">Status</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {data === null ? (
              [1, 2, 3, 4].map(i => <tr key={i}><td colSpan={9} className="px-4 py-3"><div className="h-6 bg-gray-100 rounded animate-pulse" /></td></tr>)
            ) : !rows.length ? (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-gray-400">
                {data.rows?.length ? 'No students match.' : 'No Foundation students yet — set a student\'s level to Foundation on Users → Course.'}
              </td></tr>
            ) : rows.map(r => {
              const st = r.stats
              return (
                <tr key={r.studentId} className="align-top hover:bg-gray-50/60">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{r.name || '—'}</div>
                    <div className="text-xs text-gray-400">{r.phone}</div>
                  </td>
                  <td className="px-4 py-3">
                    {r.parentPhone
                      ? <><div className="text-gray-800">{showPhone(r.parentPhone)}</div>{r.parentName && <div className="text-xs text-gray-400">{r.parentName}</div>}</>
                      : <span className="text-xs text-amber-700">Not set</span>}
                    <button type="button" onClick={() => setContactRow(r)} className="block text-[11px] font-medium text-indigo-600 hover:underline mt-0.5">
                      {r.parentPhone ? 'Edit' : 'Add number'}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    {r.status !== 'no longer Foundation' && (
                      <div className="flex items-center gap-2">
                        <Switch on={!r.reportsOff} busy={busy === `switch:${r.studentId}`}
                          label={r.reportsOff ? `Reports off for ${r.name} — click to turn on` : `Reports on for ${r.name} — click to turn off`}
                          onChange={(on) => toggleReports(r, on)} />
                        <span className={`text-[11px] font-medium ${r.reportsOff ? 'text-gray-400' : 'text-emerald-700'}`}>{r.reportsOff ? 'Off' : 'On'}</span>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">{st ? <Stat a={st.period.attended} b={st.period.held} pct={st.period.percent} /> : <span className="text-gray-300">—</span>}</td>
                  <td className="px-4 py-3">{st ? <Stat a={st.period.workSubmitted} b={st.period.held} sub={`overall ${st.overall.workSubmitted} / ${st.overall.held}`} /> : <span className="text-gray-300">—</span>}</td>
                  <td className="px-4 py-3">{st ? <Stat a={`${st.overall.percent}%`} sub={`${st.overall.attended} of ${st.overall.held} classes`} /> : <span className="text-gray-300">—</span>}</td>
                  <td className="px-4 py-3">{st ? <Stat a={`${st.syllabus.percent}%`} sub={`${st.syllabus.chaptersDone} of ${st.syllabus.chaptersTotal} chapters`} /> : <span className="text-gray-300">—</span>}</td>
                  <td className="px-4 py-3 max-w-[220px]">
                    <Chip state={r.state} />
                    <div className={`text-[11px] mt-1 ${r.state === 'failed' ? 'text-rose-600' : 'text-gray-400'}`}>{statusLine(r, r.state)}</div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-right">
                    {st && st.period.held > 0 && (
                      <button type="button" onClick={() => setPreviewRow(r)} className={`${btn.small} border-gray-200 text-gray-600 hover:bg-gray-50 mr-1.5`}>Preview</button>
                    )}
                    {(r.state === 'ready' || r.state === 'failed' || r.state === 'sent') && (
                      <button type="button" onClick={() => send(r)} disabled={!!sendBlock || !!busy} title={sendBlock}
                        className={`${btn.small} border-indigo-200 text-indigo-700 hover:bg-indigo-50`}>
                        {busy === r.studentId ? 'Sending…' : r.state === 'sent' ? 'Resend' : r.state === 'failed' ? 'Retry' : 'Send'}
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-gray-400 mt-2">
        Classes = live classes held for the student in the period (attended = marked present). Class work = classes the student handed in work for.
        Overall and syllabus = the student's current batch so far. Numbers of sent reports are what the parent received.
      </p>

      {previewRow && (
        <Modal title={`Message to ${previewRow.name}'s parent`} subtitle={previewRow.parentPhone ? showPhone(previewRow.parentPhone) : 'No parent number yet'} onClose={() => setPreviewRow(null)} width="max-w-md">
          <pre className="text-[13px] leading-relaxed whitespace-pre-wrap font-sans bg-emerald-50 border border-emerald-100 rounded-xl px-3.5 py-3 text-gray-800">
            {reportMessage(kind, previewRow.name, data.periodLabel, previewRow.stats, cfg?.contact)}
          </pre>
        </Modal>
      )}
      {contactRow && (
        <ParentContactModal student={contactRow} onClose={() => setContactRow(null)} onSaved={() => load()} />
      )}
      {settingsOpen && cfg && (
        <SettingsModal config={cfg} onClose={() => setSettingsOpen(false)}
          onSaved={(c) => { setData(d => ({ ...d, config: c })); setToast({ text: 'Settings saved' }); load() }} />
      )}
      {toast && (
        <div role="status" className={`fixed bottom-5 right-5 z-[60] max-w-sm flex items-start gap-3 px-4 py-3 rounded-xl shadow-lg text-sm ${toast.error ? 'bg-rose-600 text-white' : 'bg-gray-900 text-white'}`}>
          <span className="flex-1">{toast.text}</span>
          <button type="button" onClick={() => setToast(null)} aria-label="Dismiss" className="opacity-70 hover:opacity-100">✕</button>
        </div>
      )}
    </div>
  )
}
