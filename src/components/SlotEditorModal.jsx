import { useState } from 'react'
import { apiFetch } from '../api'
import { SLOT_OPTIONS, SLOT_KEYS, DAY_TYPES, availableSlots, availabilityLabel } from '../lib/rosterFilter'

// Which of the four class slots one student can attend, on weekdays and on
// weekends — the tutoring sheet's "Weekdays 1,4 / Weekends 1,4" columns. A
// student takes any one to four slots and comes on weekdays only, weekends
// only, or all seven days; it is not per paper. Admins change this whenever
// the student's convenience shifts, and saving replaces the whole set. Used
// from the Users page and the Live Classes scheduler.

const DAY_MODES = [
  { key: 'both',     label: 'All 7 days',    hint: 'Comes on weekdays and weekends' },
  { key: 'weekdays', label: 'Weekdays only', hint: 'Mon–Fri only' },
  { key: 'weekends', label: 'Weekends only', hint: 'Sat–Sun only' },
]

export default function SlotEditorModal({ student, onSaved, onClose }) {
  const initialWd = availableSlots(student, 'weekdays')
  const initialWe = availableSlots(student, 'weekends')
  const [picked, setPicked] = useState({ weekdays: initialWd, weekends: initialWe })
  // Which days they come on. A student with nothing set yet starts at "all 7
  // days" — the common case on the sheet — so both columns are open.
  const [mode, setMode] = useState(
    initialWd.length && !initialWe.length ? 'weekdays'
      : initialWe.length && !initialWd.length ? 'weekends'
      : 'both')
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState('')

  const enabled = (dayType) => mode === 'both' || mode === dayType
  const has = (dayType, key) => picked[dayType].includes(key)
  const toggle = (dayType, key) => setPicked(p => ({
    ...p,
    // Kept in slot order so the summary reads "1,4", never "4,1".
    [dayType]: SLOT_KEYS.filter(k => (k === key ? !p[dayType].includes(k) : p[dayType].includes(k))),
  }))
  const copyWeekdays = () => setPicked(p => ({ ...p, weekends: [...p.weekdays] }))

  // Only the day types the mode allows are saved; a hidden column is dropped.
  const toSave = {
    weekdays: enabled('weekdays') ? picked.weekdays : [],
    weekends: enabled('weekends') ? picked.weekends : [],
  }
  const summary = availabilityLabel({ slotAvailability: toSave })

  const save = async () => {
    setBusy(true); setError('')
    try {
      const d = await apiFetch(`/api/admin/users/${student._id}/slot-availability`, {
        method: 'PATCH',
        body: JSON.stringify(toSave),
      })
      onSaved(d.user)
    } catch (err) {
      setError(err.message || 'Could not save slot availability')
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={() => !busy && onClose()}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-5 max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>
        <h2 className="text-base font-bold text-gray-900">Slot availability</h2>
        <p className="text-xs text-gray-400 mb-4">
          {student.name || student.phoneNumber} — which of the four slots they can attend, and on which days. Change any time.
        </p>

        {/* Class days: weekdays only / weekends only / all seven */}
        <p className="text-[10px] font-bold text-gray-400 uppercase mb-1.5">Class days</p>
        <div className="flex flex-wrap gap-1 mb-4">
          {DAY_MODES.map(m => (
            <button key={m.key} type="button" onClick={() => setMode(m.key)} title={m.hint}
              className={`text-[11px] font-bold px-2.5 py-1.5 rounded-lg transition-colors ${
                mode === m.key ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
              {m.label}
            </button>
          ))}
        </div>

        {/* Slot × day-type grid: tick the slots they can take in each column */}
        <p className="text-[10px] font-bold text-gray-400 uppercase mb-1.5">Slots — pick 1 to 4</p>
        <table className="w-full">
          <thead>
            <tr>
              <th className="text-left text-[10px] font-bold text-gray-400 uppercase pb-1.5">Slot</th>
              {DAY_TYPES.map(dt => (
                <th key={dt.key}
                  className={`text-center text-[10px] font-bold uppercase pb-1.5 w-28 ${enabled(dt.key) ? 'text-gray-500' : 'text-gray-300'}`}>
                  {dt.long}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SLOT_OPTIONS.map(o => (
              <tr key={o.key} className="border-t border-gray-100">
                <td className="py-2 pr-2">
                  <p className="text-xs font-semibold text-gray-700">{o.num}. {o.name}</p>
                  <p className="text-[10px] text-gray-400">{o.time}</p>
                </td>
                {DAY_TYPES.map(dt => {
                  const on = enabled(dt.key) && has(dt.key, o.key)
                  return (
                    <td key={dt.key} className="py-2 text-center">
                      <button type="button" disabled={!enabled(dt.key)}
                        onClick={() => toggle(dt.key, o.key)}
                        title={!enabled(dt.key) ? `Not coming on ${dt.label.toLowerCase()} — change Class days above`
                          : on ? `Slot ${o.num} on ${dt.label.toLowerCase()} — click to remove`
                          : `Add slot ${o.num} on ${dt.label.toLowerCase()}`}
                        className={`w-9 h-9 rounded-lg border text-sm font-bold transition-colors ${
                          !enabled(dt.key) ? 'border-gray-100 bg-gray-50 text-gray-200 cursor-not-allowed'
                            : on ? 'bg-indigo-600 border-indigo-600 text-white'
                            : 'border-gray-200 text-gray-300 hover:border-indigo-300 hover:text-indigo-400'}`}>
                        {on ? '✓' : ''}
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {mode === 'both' && picked.weekdays.length > 0 && (
          <button type="button" onClick={copyWeekdays}
            className="mt-2 text-[11px] font-semibold text-indigo-600 hover:text-indigo-800">
            Same slots on weekends as weekdays
          </button>
        )}

        <div className="mt-4 px-3 py-2 rounded-lg bg-gray-50 text-xs">
          {summary
            ? <span className="text-gray-700">🕐 <b>{summary}</b></span>
            : <span className="text-gray-400">No slots picked — saving clears their availability.</span>}
        </div>

        {error && <p className="text-xs text-red-500 mt-3">{error}</p>}
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} disabled={busy}
            className="px-4 py-2 rounded-xl border border-gray-200 text-gray-500 text-sm font-semibold hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={save} disabled={busy}
            className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:bg-gray-300">
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
