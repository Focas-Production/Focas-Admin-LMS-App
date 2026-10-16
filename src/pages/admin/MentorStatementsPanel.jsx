// Monthly WhatsApp statement — the Mentor Hours page's "payment confirmation"
// panel. On the scheduled day (1st, 09:00 IST by default) every mentor gets last
// month's slots and working hours on WhatsApp with two links and two buttons
// ("Yes, data is correct" / "Need correction"). This panel shows, per month,
// who was sent what and how they answered, and lets the admin send / resend,
// switch a mentor off, keep private notes and change the schedule.
// Data: /api/admin/mentor-statements (server/controllers/mentorStatementController.js).
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { apiFetch } from '../../api'

// ───────────────────────────── helpers ─────────────────────────────

const fmtHours = (ms) => {
  const m = Math.round((ms || 0) / 60000)
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}
const fmtStamp = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '')
// "2026-09": the IST month before this one.
function lastMonth() {
  const d = new Date(Date.now() + 330 * 60 * 1000)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 7)
}
const isLong = (t) => t.length > 140 || t.split('\n').length > 2

// Every row lands in exactly one of these. Order = sort order (needs action first).
const KINDS = {
  correction: { label: 'Needs correction', chip: 'bg-orange-50 text-orange-700 ring-orange-200', dot: 'bg-orange-500', accent: 'border-l-orange-400' },
  failed:     { label: 'Send failed',      chip: 'bg-rose-50 text-rose-700 ring-rose-200',       dot: 'bg-rose-500',   accent: 'border-l-rose-400' },
  sending:    { label: 'Sending…',         chip: 'bg-sky-50 text-sky-700 ring-sky-200',          dot: 'bg-sky-500',    accent: 'border-l-transparent' },
  waiting:    { label: 'Waiting',          chip: 'bg-amber-50 text-amber-700 ring-amber-200',    dot: 'bg-amber-400',  accent: 'border-l-transparent' },
  notsent:    { label: 'Not sent',         chip: 'bg-gray-100 text-gray-600 ring-gray-200',      dot: 'bg-gray-400',   accent: 'border-l-transparent' },
  confirmed:  { label: 'Confirmed',        chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200', dot: 'bg-emerald-500', accent: 'border-l-transparent' },
  off:        { label: 'Turned off',       chip: 'bg-gray-100 text-gray-500 ring-gray-200',      dot: 'bg-gray-300',   accent: 'border-l-transparent' },
  skipped:    { label: 'Skipped',          chip: 'bg-gray-100 text-gray-500 ring-gray-200',      dot: 'bg-gray-300',   accent: 'border-l-transparent' },
}
const ORDER = Object.keys(KINDS)

function kindOf(row) {
  if (row.enabled === false) return 'off'
  const s = row.statement
  if (!s) return row.preview?.startsWith('skipped') ? 'skipped' : 'notsent'
  return { correction: 'correction', failed: 'failed', sending: 'sending', sent: 'waiting', accepted: 'confirmed' }[s.status] || 'waiting'
}

// The one line under the status chip: when it happened, and what to do next.
function statusLine(row, kind) {
  const s = row.statement
  switch (kind) {
    case 'confirmed': return `Confirmed ${fmtStamp(s.response?.at)}`
    case 'correction': return `Asked ${fmtStamp(s.response?.at)} · fix classes, then Resend`
    case 'failed': return s.lastError || 'WhatsApp did not accept the message'
    case 'waiting': return `Sent ${fmtStamp(s.sentAt)}${s.version > 1 ? ` · v${s.version}` : ''}`
    case 'sending': return 'In progress'
    case 'skipped': return row.preview.replace('skipped: ', '')
    case 'off': return 'No statement for this mentor'
    default: return 'Not sent yet'
  }
}

// ───────────────────────────── building blocks ─────────────────────────────

const btn = {
  primary: 'inline-flex items-center justify-center gap-1.5 text-sm px-3.5 py-2 rounded-lg bg-indigo-600 text-white font-medium shadow-sm hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed',
  secondary: 'inline-flex items-center justify-center gap-1.5 text-sm px-3.5 py-2 rounded-lg bg-white border border-gray-200 text-gray-700 font-medium hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed',
  danger: 'inline-flex items-center justify-center gap-1.5 text-sm px-3.5 py-2 rounded-lg bg-rose-600 text-white font-medium hover:bg-rose-700 disabled:opacity-40',
  ghostDanger: 'inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg text-rose-600 hover:bg-rose-50 disabled:opacity-40',
  small: 'inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border font-medium disabled:opacity-40 disabled:cursor-not-allowed',
  link: 'text-[11px] font-medium text-indigo-600 hover:text-indigo-800 hover:underline',
}
const fieldCls = 'text-sm px-3 py-2 bg-white border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400'
const inputCls = `w-full ${fieldCls}`

// Accessible modal: backdrop click / Esc close (via onClose, which may refuse),
// page scroll locked, focus moved into the dialog and restored after. Modals
// can stack (a confirm over the note editor) — only the top one hears Esc.
const modalStack = []
let modalSeq = 0
function Modal({ title, subtitle, onClose, children, footer, width = 'max-w-lg', as = 'div', onSubmit }) {
  const ref = useRef(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose }, [onClose])
  useEffect(() => {
    const id = ++modalSeq
    modalStack.push(id)
    const prevFocus = document.activeElement
    const onKey = (e) => { if (e.key === 'Escape' && modalStack[modalStack.length - 1] === id) onCloseRef.current() }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    if (!ref.current?.contains(document.activeElement)) ref.current?.focus()
    return () => {
      modalStack.splice(modalStack.indexOf(id), 1)
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      prevFocus?.focus?.()
    }
  }, [])
  const Box = as
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/40" onMouseDown={onClose} role="presentation">
      <Box ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title}
        onMouseDown={(e) => e.stopPropagation()} onSubmit={onSubmit}
        className={`w-full ${width} max-h-[88vh] flex flex-col bg-white rounded-2xl shadow-2xl outline-none`}>
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
      </Box>
    </div>
  )
}

// Promise-based confirm dialog: `await confirm({ title, body, confirmLabel, danger })`.
function useConfirm() {
  const [req, setReq] = useState(null)
  const confirm = useCallback((opts) => new Promise((resolve) => setReq({ ...opts, resolve })), [])
  const done = (v) => { req?.resolve(v); setReq(null) }
  const dialog = req && (
    <Modal title={req.title} onClose={() => done(false)} width="max-w-md"
      footer={(
        <>
          <button type="button" onClick={() => done(false)} className={`ml-auto ${btn.secondary}`}>Cancel</button>
          <button type="button" autoFocus onClick={() => done(true)} className={req.danger ? btn.danger : btn.primary}>
            {req.confirmLabel || 'Confirm'}
          </button>
        </>
      )}>
      <div className="text-sm text-gray-700 space-y-2">{req.body}</div>
    </Modal>
  )
  return [confirm, dialog]
}

// Bottom-right toast that clears itself.
function Toast({ toast, onDone }) {
  useEffect(() => {
    if (!toast) return undefined
    const t = setTimeout(onDone, toast.kind === 'error' ? 8000 : 4000)
    return () => clearTimeout(t)
  }, [toast, onDone])
  if (!toast) return null
  return (
    <div role="status" className={`fixed bottom-5 right-5 z-[60] max-w-sm flex items-start gap-3 px-4 py-3 rounded-xl shadow-lg text-sm
      ${toast.kind === 'error' ? 'bg-rose-600 text-white' : 'bg-gray-900 text-white'}`}>
      <span>{toast.kind === 'error' ? '⚠' : '✓'}</span>
      <span className="flex-1">{toast.text}</span>
      <button type="button" onClick={onDone} aria-label="Dismiss" className="opacity-70 hover:opacity-100">✕</button>
    </div>
  )
}

// Copy text to the clipboard. The async Clipboard API needs a secure page and
// permission; when it is missing or refused, fall back to a hidden textarea +
// execCommand('copy'), which works on plain http too. Resolves true/false.
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch { /* fall through to the fallback */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

// "Copy" button that says whether it worked.
function CopyButton({ text, className }) {
  const [state, setState] = useState('idle')   // idle | ok | fail
  useEffect(() => {
    if (state === 'idle') return undefined
    const t = setTimeout(() => setState('idle'), 1800)
    return () => clearTimeout(t)
  }, [state])
  return (
    <button type="button" onClick={async () => setState((await copyText(text)) ? 'ok' : 'fail')} aria-live="polite"
      className={`${className} ${state === 'ok' ? '!text-emerald-700 !border-emerald-300 !bg-emerald-50' : state === 'fail' ? '!text-rose-700 !border-rose-300' : ''}`}>
      {state === 'ok' ? 'Copied ✓' : state === 'fail' ? "Couldn't copy" : 'Copy'}
    </button>
  )
}

// Dropdown menu (CSV downloads). Drawn in a portal on top of the page, so the
// table's horizontal scroll box can't clip it; anchored to the button, opening
// upwards when there is no room below. Closes on outside click, Esc, scroll
// or resize.
function Menu({ label, items, disabled }) {
  const [pos, setPos] = useState(null)   // { top|bottom, right } while open
  const btnRef = useRef(null)
  const menuRef = useRef(null)
  const open = !!pos

  const toggle = () => {
    if (open) return setPos(null)
    const r = btnRef.current.getBoundingClientRect()
    const below = window.innerHeight - r.bottom > 44 * items.length + 16
    setPos({
      right: Math.max(8, window.innerWidth - r.right),
      ...(below ? { top: r.bottom + 4 } : { bottom: window.innerHeight - r.top + 4 }),
    })
  }

  useEffect(() => {
    if (!open) return undefined
    const close = () => setPos(null)
    const away = (e) => { if (!menuRef.current?.contains(e.target) && !btnRef.current?.contains(e.target)) close() }
    const esc = (e) => { if (e.key === 'Escape') close() }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    menuRef.current?.querySelector('button')?.focus()
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  return (
    <>
      <button ref={btnRef} type="button" disabled={disabled} onClick={toggle} aria-haspopup="menu" aria-expanded={open}
        className={`${btn.small} ${open ? 'border-indigo-300 text-indigo-700 bg-indigo-50' : 'border-gray-200 text-gray-600 bg-white hover:bg-gray-50'}`}>
        {label} <span className="text-[9px]">{open ? '▴' : '▾'}</span>
      </button>
      {open && createPortal(
        <div ref={menuRef} role="menu" style={{ position: 'fixed', ...pos }}
          className="z-[70] w-48 bg-white border border-gray-200 rounded-xl shadow-xl p-1">
          {items.map((it) => (
            <button key={it.label} type="button" role="menuitem" onClick={() => { setPos(null); it.onClick() }}
              className="w-full flex items-center gap-2 text-left text-sm px-3 py-2 rounded-lg text-gray-700 hover:bg-indigo-50 hover:text-indigo-700 focus:bg-indigo-50 focus:outline-none">
              <span className="text-gray-400">↓</span>{it.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}

function Switch({ on, onClick, disabled, label }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} title={label} onClick={onClick} disabled={disabled}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:opacity-40 ${on ? 'bg-indigo-600' : 'bg-gray-300'}`}>
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  )
}

// Two-line preview of free text with a link to the whole thing.
function Clamp({ text, quote, tone = 'text-gray-700', more, onMore }) {
  return (
    <div className="min-w-0">
      <p className={`text-xs leading-relaxed whitespace-pre-line break-words [overflow-wrap:anywhere] line-clamp-2 ${tone}`}>
        {quote ? `“${text}”` : text}
      </p>
      <button type="button" onClick={onMore} className={`${btn.link} mt-0.5`}>{more}</button>
    </div>
  )
}

// ───────────────────────────── dialogs ─────────────────────────────

// The admin-editable settings. Saved to the database and used by the server
// straight away — no .env edit, no redeploy. Server-level things (the safety
// lock MENTOR_STATEMENT_JOB, link address, R2 folder) stay in .env.
function SettingsDialog({ cfg, onClose, onSaved }) {
  const [f, setF] = useState(() => ({ ...cfg.settings, day: String(cfg.settings.day) }))
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const fromEnv = (k) => (!cfg.settings.fromAdmin[k] ? <span className="ml-1 text-[10px] font-normal text-gray-400">from .env</span> : null)
  const testOn = !!f.testPhone.trim()

  async function save(e) {
    e.preventDefault()
    setSaving(true); setErr('')
    try {
      await apiFetch('/api/admin/mentor-statements/settings', {
        method: 'PUT',
        body: JSON.stringify({ enabled: f.enabled, day: Number(f.day), time: f.time, template: f.template.trim(), testPhone: f.testPhone.trim() }),
      })
      onSaved()
    } catch (e2) {
      setErr(e2.message || 'Save failed')
      setSaving(false)
    }
  }

  const label = 'block text-xs font-medium text-gray-700 mb-1'
  return (
    <Modal as="form" onSubmit={save} title="Statement settings" subtitle="Saved changes apply immediately — no redeploy needed."
      onClose={onClose} width="max-w-xl"
      footer={(
        <>
          <button type="button" onClick={onClose} className={`ml-auto ${btn.secondary}`}>Cancel</button>
          <button type="submit" disabled={saving} className={btn.primary}>{saving ? 'Saving…' : 'Save settings'}</button>
        </>
      )}>
      <div className="space-y-5">
        <section className="flex items-start justify-between gap-4 rounded-xl border border-gray-200 p-3.5">
          <div>
            <p className="text-sm font-medium text-gray-900">Send automatically every month {fromEnv('enabled')}</p>
            <p className="text-xs text-gray-500 mt-0.5">When off, nothing goes out on its own. You can still send by hand from the table.</p>
          </div>
          <Switch on={f.enabled} onClick={() => setF((x) => ({ ...x, enabled: !x.enabled }))} label="Send automatically" />
        </section>

        <section className="grid grid-cols-2 gap-3">
          <label>
            <span className={label}>Day of month {fromEnv('day')}</span>
            <select value={f.day} onChange={set('day')} className={inputCls}>
              {Array.from({ length: 28 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
            </select>
          </label>
          <label>
            <span className={label}>Time (IST) {fromEnv('time')}</span>
            <input type="time" required value={f.time} onChange={set('time')} className={inputCls} />
          </label>
          <p className="col-span-2 text-[11px] text-gray-500 -mt-1">
            It sends the <b>previous</b> month&apos;s statement. Days 29–31 aren&apos;t offered (some months don&apos;t have them).
            If this month&apos;s send already happened, a new time applies from next month.
          </p>
        </section>

        <section>
          <label>
            <span className={label}>WhatsApp template name {fromEnv('template')}</span>
            <input required value={f.template} onChange={set('template')} placeholder="mentor_hours_statement" className={`${inputCls} font-mono`} />
          </label>
          <p className="text-[11px] text-gray-500 mt-1">Exactly as approved in WATI — lowercase letters, numbers and _.</p>
        </section>

        <section className={`rounded-xl p-3.5 ${testOn ? 'bg-violet-50 border border-violet-200' : 'border border-gray-200'}`}>
          <label>
            <span className={label}>Test phone {fromEnv('testPhone')}</span>
            <input value={f.testPhone} onChange={set('testPhone')} inputMode="numeric" placeholder="Leave empty on the live site" className={inputCls} />
          </label>
          <p className={`text-[11px] mt-1 ${testOn ? 'text-violet-700' : 'text-gray-500'}`}>
            {testOn
              ? <><b>Test mode:</b> every statement goes to this number instead of the mentors.</>
              : 'Empty = real sending to each mentor. Fill in a number only while testing.'}
          </p>
        </section>

        {err && <div className="text-xs rounded-lg px-3 py-2 bg-rose-50 text-rose-700">{err}</div>}
      </div>
    </Modal>
  )
}

function RemarksDialog({ row, monthLabel, onClose }) {
  const s = row.statement
  return (
    <Modal title={`Mentor's remarks — ${row.name}`} onClose={onClose}
      subtitle={`${monthLabel}${s.response?.at ? ` · ${fmtStamp(s.response.at)}` : ''}`}
      footer={(
        <>
          <CopyButton text={s.response.note} className={`ml-auto ${btn.secondary}`} />
          <button type="button" onClick={onClose} className={btn.primary}>Close</button>
        </>
      )}>
      {s.response?.claimedHours != null && (
        <div className="mb-3 flex gap-2 text-xs">
          <span className="px-2 py-1 rounded-md bg-gray-100 text-gray-700">Our record <b>{fmtHours(s.totals.attendedWorkingMs)}</b></span>
          <span className="px-2 py-1 rounded-md bg-orange-50 text-orange-800">Mentor says <b>{s.response.claimedHours} h</b></span>
        </div>
      )}
      <p className="text-sm leading-relaxed text-gray-800 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{s.response.note}</p>
    </Modal>
  )
}

// The admin's own private note on a mentor's month — never shown to the
// mentor, kept across resends. Up to 1000 characters; '' clears it.
// Opens read-only when a note exists (Edit to change it); straight into
// editing only for "+ Add note".
const ADMIN_NOTE_MAX = 1000
function AdminNoteDialog({ row, monthLabel, onClose, onSaved, confirm }) {
  const s = row.statement
  const saved = s.adminNote?.text || ''
  const [editing, setEditing] = useState(!saved)
  const [text, setText] = useState(saved)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const dirty = editing && text.trim() !== saved

  const discardOk = useCallback(async () => !dirty || confirm({
    title: 'Discard changes?', body: <p>Your changes to this note will be lost.</p>, confirmLabel: 'Discard', danger: true,
  }), [dirty, confirm])

  const close = useCallback(async () => { if (await discardOk()) onClose() }, [discardOk, onClose])
  const cancelEdit = async () => {
    if (!saved) return close()
    if (!(await discardOk())) return
    setText(saved); setErr(''); setEditing(false)
  }

  async function save(value = text) {
    setSaving(true); setErr('')
    try {
      await apiFetch(`/api/admin/mentor-statements/${s.id}/note`, { method: 'PUT', body: JSON.stringify({ note: value }) })
      onSaved(value.trim() ? 'Note saved' : 'Note deleted')
    } catch (e) {
      setErr(e.message || 'Save failed')
      setSaving(false)
    }
  }
  const remove = async () => {
    if (await confirm({ title: 'Delete this note?', body: <p>The note for <b>{row.name}</b> will be removed.</p>, confirmLabel: 'Delete', danger: true })) save('')
  }

  return (
    <Modal as="form" onSubmit={(e) => { e.preventDefault(); if (dirty) save() }} onClose={close}
      title={`${editing ? (saved ? 'Edit admin note' : 'Add admin note') : 'Admin note'} — ${row.name}`}
      subtitle={`${monthLabel} · private — the mentor never sees this`}
      footer={editing ? (
        <>
          <span className="text-[11px] text-gray-400 hidden sm:inline">Ctrl + Enter to save</span>
          <button type="button" onClick={cancelEdit} className={`ml-auto ${btn.secondary}`}>Cancel</button>
          <button type="submit" disabled={saving || !dirty} className={btn.primary}>{saving ? 'Saving…' : 'Save note'}</button>
        </>
      ) : (
        <>
          <button type="button" disabled={saving} onClick={remove} className={btn.ghostDanger}>Delete</button>
          <CopyButton text={saved} className={`ml-auto ${btn.secondary}`} />
          <button type="button" onClick={() => setEditing(true)} className={btn.primary}>Edit</button>
        </>
      )}>
      {editing ? (
        <textarea autoFocus value={text} maxLength={ADMIN_NOTE_MAX} rows={8}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && dirty && !saving) save() }}
          placeholder="e.g. Paid ₹… on 5 Nov · 2 slots on 12 Sep were cover classes · checked by phone"
          className={`${inputCls} resize-y leading-relaxed`} />
      ) : (
        <p className="text-sm leading-relaxed text-gray-800 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{saved}</p>
      )}
      <div className="flex justify-between mt-2 text-[11px] text-gray-400">
        <span>{s.adminNote?.at ? `Last saved by ${s.adminNote.by || 'admin'} · ${fmtStamp(s.adminNote.at)}` : 'No note yet'}</span>
        {editing && <span className={text.length > ADMIN_NOTE_MAX - 50 ? 'text-amber-600 font-medium' : ''}>{text.length} / {ADMIN_NOTE_MAX}</span>}
      </div>
      {err && <div className="mt-2 text-xs rounded-lg px-3 py-2 bg-rose-50 text-rose-700">{err}</div>}
    </Modal>
  )
}

// ───────────────────────────── the panel ─────────────────────────────

function SkeletonRows() {
  return Array.from({ length: 4 }, (_, i) => (
    <tr key={i} className="border-t border-gray-100">
      {Array.from({ length: 7 }, (_, j) => (
        <td key={j} className="px-3 py-4"><div className="h-3 rounded bg-gray-100 animate-pulse" style={{ width: `${40 + ((i + j) % 3) * 20}%` }} /></td>
      ))}
    </tr>
  ))
}

export default function MentorStatementsPanel() {
  const [month, setMonth] = useState(lastMonth)
  const [data, setData] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState('')            // '' | 'all' | 'reset' | mentorId | `t${mentorId}`
  const [toast, setToast] = useState(null)        // { text, kind }
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [dialog, setDialog] = useState(null)      // { type: 'settings' | 'remarks' | 'note', row? }
  const [confirm, confirmDialog] = useConfirm()

  const fetchMonth = useCallback(() => apiFetch(`/api/admin/mentor-statements?month=${month}`), [month])
  const reload = useCallback(() => fetchMonth().then((d) => { setData(d); setLoadError('') }).catch((e) => setLoadError(e.message || 'Failed to load')), [fetchMonth])

  useEffect(() => {
    let alive = true
    fetchMonth()
      .then((d) => { if (alive) { setData(d); setLoadError('') } })
      .catch((e) => alive && setLoadError(e.message || 'Failed to load'))
    return () => { alive = false }
  }, [fetchMonth])

  const loading = !data || data.month !== month
  const cfg = data?.config
  const blocked = cfg?.blocker || data?.monthBlocked || ''
  const rows = useMemo(() => (loading ? [] : data.rows), [data, loading])
  const withKind = useMemo(() => rows.map((r) => ({ ...r, kind: kindOf(r) }))
    .sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || a.name.localeCompare(b.name)), [rows])
  const counts = useMemo(() => withKind.reduce((m, r) => ({ ...m, [r.kind]: (m[r.kind] || 0) + 1 }), {}), [withKind])
  const notSent = counts.notsent || 0
  const q = query.trim().toLowerCase()
  const visible = withKind.filter((r) => (filter === 'all' || r.kind === filter)
    && (!q || r.name.toLowerCase().includes(q) || (r.phone || '').includes(q)))

  const closeToast = useCallback(() => setToast(null), [])
  async function act(key, fn, okMsg) {
    setBusy(key)
    try {
      const r = await fn()
      setToast({ text: typeof okMsg === 'function' ? okMsg(r) : okMsg, kind: 'ok' })
    } catch (e) {
      setToast({ text: e.message || 'Something went wrong', kind: 'error' })
    } finally {
      setBusy('')
      reload()
    }
  }

  const sendAll = async () => {
    if (!(await confirm({
      title: `Send ${data.monthLabel} statements?`, confirmLabel: `Send to ${notSent}`,
      body: <p>{notSent} mentor{notSent === 1 ? '' : 's'} who haven&apos;t got it yet will receive the statement on WhatsApp now{cfg?.testPhone ? <> — <b>test mode: all go to {cfg.testPhone}</b></> : ''}.</p>,
    }))) return
    act('all', () => apiFetch('/api/admin/mentor-statements/run', { method: 'POST', body: JSON.stringify({ month }) }),
      (r) => `Sent ${r.summary.sent}${r.summary.failed ? `, failed ${r.summary.failed}` : ''}${r.summary.skipped ? `, skipped ${r.summary.skipped}` : ''}`)
  }
  const sendOne = async (row) => {
    const again = !!row.statement
    if (!(await confirm({
      title: again ? `Resend to ${row.name}?` : `Send to ${row.name}?`,
      confirmLabel: again ? 'Resend' : 'Send',
      body: again
        ? (
          <>
            <p>A fresh {data.monthLabel} statement is built from today&apos;s class data and sent on WhatsApp.</p>
            <p className="text-gray-500">The links in the earlier message stop working{row.statement.status === 'accepted' ? <> and <b>their confirmation is reset</b></> : ''}. Your admin note is kept.</p>
          </>
        )
        : <p>{row.name} will receive the {data.monthLabel} statement on WhatsApp now.</p>,
    }))) return
    act(row.mentorId, () => (again
      ? apiFetch(`/api/admin/mentor-statements/${row.statement.id}/resend`, { method: 'POST' })
      : apiFetch('/api/admin/mentor-statements/run', { method: 'POST', body: JSON.stringify({ month, mentorId: row.mentorId }) })),
    `Sent to ${row.name}`)
  }
  const toggle = async (row) => {
    const on = row.enabled === false
    if (!(await confirm({
      title: on ? `Turn on for ${row.name}?` : `Turn off for ${row.name}?`,
      confirmLabel: on ? 'Turn on' : 'Turn off', danger: !on,
      body: on
        ? <p>{row.name} will get the monthly statement again from the next send.</p>
        : <p>{row.name} won&apos;t get the monthly statement (for trainees and test accounts) until you turn it back on. Statements already sent are not affected.</p>,
    }))) return
    act(`t${row.mentorId}`, () => apiFetch(`/api/admin/mentor-statements/mentors/${row.mentorId}`, { method: 'PUT', body: JSON.stringify({ enabled: on }) }),
      `${row.name}: monthly statement ${on ? 'on' : 'off'}`)
  }
  const resetTest = async () => {
    if (!(await confirm({
      title: `Reset ${data.monthLabel}? (test)`, confirmLabel: 'Reset', danger: true,
      body: <p>Deletes every {data.monthLabel} statement and its files, so the automatic send runs again at the set day and time. Only works in test mode.</p>,
    }))) return
    act('reset', () => apiFetch('/api/admin/mentor-statements/reset-test', { method: 'POST', body: JSON.stringify({ month }) }),
      (r) => `Reset — ${r.deleted} statement(s) removed`)
  }
  const download = async (row, file) => {
    try {
      const { url } = await apiFetch(`/api/admin/mentor-statements/${row.statement.id}/download?file=${file}`)
      window.location.assign(url)
    } catch (e) { setToast({ text: e.message || 'Download failed', kind: 'error' }) }
  }

  const chips = [['all', 'All', withKind.length], ...ORDER.filter((k) => counts[k]).map((k) => [k, KINDS[k].label, counts[k]])]
  const th = 'px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500'

  return (
    <section className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      {/* ── header ── */}
      <div className="px-5 pt-5 pb-4 flex flex-wrap items-start gap-4 border-b border-gray-100">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-gray-900">Monthly statement to mentors</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Each mentor confirms last month&apos;s slots and working hours on WhatsApp before payment.
          </p>
          {cfg && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              {cfg.autoEnabled
                ? <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-emerald-50 text-emerald-700"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />Automatic · {cfg.schedule}</span>
                : <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-amber-50 text-amber-700"><span className="w-1.5 h-1.5 rounded-full bg-amber-500" />Automatic sending is off</span>}
              <span className="px-2 py-1 rounded-md bg-gray-100 text-gray-600 font-mono">{cfg.settings.template || 'no template'}</span>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input type="month" value={month} aria-label="Statement month"
            onChange={(e) => e.target.value && setMonth(e.target.value)} className={fieldCls} />
          <button type="button" onClick={() => setDialog({ type: 'settings' })} disabled={!cfg} className={btn.secondary}>⚙ Settings</button>
          <button type="button" onClick={sendAll} disabled={loading || !!blocked || !notSent || !!busy}
            title={blocked || (!notSent ? 'Everyone has already been sent this month' : '')} className={btn.primary}>
            {busy === 'all' ? 'Sending…' : notSent ? `Send to ${notSent} not sent` : 'All sent'}
          </button>
        </div>
      </div>

      {/* ── banners ── */}
      {(cfg?.testPhone || (blocked && !loading) || loadError) && (
        <div className="px-5 pt-4 space-y-2">
          {cfg?.testPhone && (
            <div className="flex flex-wrap items-center gap-2 text-xs rounded-lg px-3 py-2 bg-violet-50 text-violet-800 border border-violet-100">
              <span><b>Test mode</b> — every message goes to <b>{cfg.testPhone}</b>, not to the mentors. Clear the test phone in Settings before going live.</span>
              <button type="button" onClick={resetTest} disabled={!!busy || loading}
                className={`ml-auto ${btn.small} border-violet-300 bg-white text-violet-700 hover:bg-violet-100`}>
                {busy === 'reset' ? 'Resetting…' : `Reset ${data?.monthLabel || month}`}
              </button>
            </div>
          )}
          {blocked && !loading && <div className="text-xs rounded-lg px-3 py-2 bg-amber-50 text-amber-800 border border-amber-100">Sending is not possible for this month: {blocked}</div>}
          {loadError && (
            <div className="flex items-center gap-2 text-xs rounded-lg px-3 py-2 bg-rose-50 text-rose-700 border border-rose-100">
              Couldn&apos;t load: {loadError}
              <button type="button" onClick={reload} className={`ml-auto ${btn.small} border-rose-200 bg-white text-rose-700`}>Retry</button>
            </div>
          )}
        </div>
      )}

      {/* ── filters ── */}
      <div className="px-5 pt-4 pb-3 flex flex-wrap items-center gap-2">
        {chips.map(([k, label, n]) => {
          const active = filter === k
          return (
            <button key={k} type="button" onClick={() => setFilter(k)} aria-pressed={active}
              className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full ring-1 transition-colors ${active
                ? 'bg-indigo-600 text-white ring-indigo-600'
                : k === 'all' ? 'bg-white text-gray-600 ring-gray-200 hover:ring-indigo-300' : `${KINDS[k].chip} hover:brightness-95`}`}>
              {k !== 'all' && !active && <span className={`w-1.5 h-1.5 rounded-full ${KINDS[k].dot}`} />}
              {label}<span className={`tabular-nums font-semibold ${active ? 'text-white' : ''}`}>{n}</span>
            </button>
          )
        })}
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search mentor or phone…"
          aria-label="Search mentor" className={`${fieldCls} ml-auto w-60 !py-1.5`} />
      </div>

      {/* ── table ── */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50/80 border-y border-gray-100">
            <tr className="text-left">
              <th className={`${th} pl-5`}>Mentor</th>
              <th className={`${th} text-right`}>Our record</th>
              <th className={th}>Status</th>
              <th className={`${th} text-right`} title="Total working hours the mentor entered when asking for a correction">Mentor says</th>
              <th className={th}>Mentor&apos;s remarks</th>
              <th className={th} title="Private — the mentor never sees it">Admin note</th>
              <th className={`${th} pr-5 text-right`}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && !loadError ? <SkeletonRows /> : visible.length === 0 ? (
              <tr><td colSpan={7} className="px-5 py-12 text-center text-sm text-gray-400">
                {!rows.length ? `No mentor classes in ${data?.monthLabel || month}.` : 'No mentor matches this filter.'}
              </td></tr>
            ) : visible.map((r) => {
              const s = r.statement
              const k = KINDS[r.kind]
              const canSend = !blocked && !busy && r.kind !== 'off' && r.kind !== 'skipped' && r.kind !== 'sending'
              const claimed = r.kind === 'correction' && s.response?.claimedHours != null ? s.response.claimedHours : null
              const diffMs = claimed != null ? claimed * 3600000 - s.totals.attendedWorkingMs : 0
              return (
                <tr key={r.mentorId} className={`border-t border-gray-100 align-top border-l-4 ${k.accent} hover:bg-gray-50/70 ${r.kind === 'off' ? 'opacity-60' : ''}`}>
                  {/* mentor + monthly switch */}
                  <td className="pl-4 pr-3 py-3">
                    <div className="flex items-start gap-3">
                      {r.canToggle !== false
                        ? <div className="pt-0.5"><Switch on={r.enabled !== false} disabled={!!busy} onClick={() => toggle(r)}
                            label={r.enabled !== false ? `Monthly statement on for ${r.name} — click to turn off` : `Off for ${r.name} — click to turn on`} /></div>
                        : <div className="w-9" />}
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 whitespace-nowrap">{r.name}</p>
                        <p className="text-[11px] text-gray-400 tabular-nums">{r.phone || 'no phone'}</p>
                      </div>
                    </div>
                  </td>
                  {/* our numbers */}
                  <td className="px-3 py-3 text-right whitespace-nowrap">
                    {s ? (
                      <>
                        <p className="font-semibold text-sky-700 tabular-nums">{fmtHours(s.totals.attendedWorkingMs)}</p>
                        <p className="text-[11px] text-gray-400 tabular-nums">{s.totals.attendedCount} / {s.totals.slotCount} slots</p>
                      </>
                    ) : <span className="text-gray-300">—</span>}
                  </td>
                  {/* status */}
                  <td className="px-3 py-3 max-w-[16rem]">
                    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ring-1 whitespace-nowrap ${k.chip}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${k.dot}`} />{k.label}
                    </span>
                    <p className={`text-[11px] mt-1 ${r.kind === 'failed' ? 'text-rose-600' : 'text-gray-400'} line-clamp-2`}>{statusLine(r, r.kind)}</p>
                  </td>
                  {/* mentor's figure */}
                  <td className="px-3 py-3 text-right whitespace-nowrap">
                    {claimed != null ? (
                      <>
                        <p className="font-semibold text-gray-900 tabular-nums">{claimed} h</p>
                        <span className={`inline-block mt-0.5 text-[11px] px-1.5 rounded tabular-nums ${Math.abs(diffMs) < 60000 ? 'bg-gray-100 text-gray-500' : diffMs > 0 ? 'bg-orange-50 text-orange-700' : 'bg-sky-50 text-sky-700'}`}>
                          {Math.abs(diffMs) < 60000 ? 'same as ours' : `${diffMs > 0 ? '+' : '−'}${fmtHours(Math.abs(diffMs))}`}
                        </span>
                      </>
                    ) : <span className="text-gray-300">—</span>}
                  </td>
                  {/* remarks */}
                  <td className="px-3 py-3 w-60 max-w-60">
                    {s?.response?.note ? (
                      <Clamp text={s.response.note} quote tone={r.kind === 'correction' ? 'text-gray-800' : 'text-gray-400'}
                        more={isLong(s.response.note) ? `Read full · ${s.response.note.length} chars` : 'Open'}
                        onMore={() => setDialog({ type: 'remarks', row: r })} />
                    ) : <span className="text-gray-300">—</span>}
                  </td>
                  {/* admin note */}
                  <td className="px-3 py-3 w-52 max-w-52">
                    {!s ? <span className="text-[11px] text-gray-300" title="Send the statement first">—</span>
                      : s.adminNote?.text ? (
                        <Clamp text={s.adminNote.text} more={isLong(s.adminNote.text) ? 'Read full' : 'View'}
                          onMore={() => setDialog({ type: 'note', row: r })} />
                      ) : (
                        <button type="button" onClick={() => setDialog({ type: 'note', row: r })}
                          className="text-[11px] font-medium text-gray-400 hover:text-indigo-600 border border-dashed border-gray-300 hover:border-indigo-300 rounded-md px-2 py-1 whitespace-nowrap">
                          + Add note
                        </button>
                      )}
                  </td>
                  {/* actions */}
                  <td className="pl-3 pr-5 py-3 text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-1.5">
                      {s?.version > 0 && (
                        <Menu label="CSV" items={[
                          { label: 'Summary CSV', onClick: () => download(r, 'summary') },
                          { label: 'Detailed CSV', onClick: () => download(r, 'detailed') },
                        ]} />
                      )}
                      <button type="button" onClick={() => sendOne(r)} disabled={!canSend}
                        title={blocked || (r.kind === 'off' ? 'Turned off for this mentor' : '')}
                        className={`${btn.small} ${r.kind === 'correction' || r.kind === 'failed' || r.kind === 'notsent'
                          ? 'border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700'
                          : 'border-indigo-200 bg-white text-indigo-700 hover:bg-indigo-50'}`}>
                        {busy === r.mentorId ? 'Sending…' : s ? 'Resend' : 'Send'}
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="px-5 py-3 text-[11px] leading-relaxed text-gray-400 border-t border-gray-100">
        Statements are frozen when sent and kept in Cloudflare R2 under <span className="font-mono">{cfg?.r2Folder || 'mentor-hours-statements/'}</span>.
        For a correction: fix the mentor&apos;s classes, then <b>Resend</b> — a fresh statement goes out and the old links stop working.
        Admin notes are private. Mentors switched off, admin-only hosts and hosts without a phone number get nothing.
      </p>

      {dialog?.type === 'settings' && cfg && (
        <SettingsDialog cfg={cfg} onClose={() => setDialog(null)}
          onSaved={() => { setDialog(null); setToast({ text: 'Settings saved — in effect now', kind: 'ok' }); reload() }} />
      )}
      {dialog?.type === 'remarks' && <RemarksDialog row={dialog.row} monthLabel={data?.monthLabel} onClose={() => setDialog(null)} />}
      {dialog?.type === 'note' && (
        <AdminNoteDialog row={dialog.row} monthLabel={data?.monthLabel} confirm={confirm} onClose={() => setDialog(null)}
          onSaved={(msg) => { setDialog(null); setToast({ text: `${dialog.row.name}: ${msg}`, kind: 'ok' }); reload() }} />
      )}
      {confirmDialog}
      <Toast toast={toast} onDone={closeToast} />
    </section>
  )
}
