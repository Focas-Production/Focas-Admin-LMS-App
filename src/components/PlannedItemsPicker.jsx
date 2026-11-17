// "＋ Add another chapter/unit" rows under a class's main chapter pick.
// Extras are PLANNED only: they show on the class card and allot the students,
// but count as finished only when the mentor ticks them after the class.
// Same subject as the main pick — the server enforces that too.
//
//   subject  — the picked subject (with chapters → units), or undefined
//   primary  — { chapterId, unitId } of the main pick
//   value    — [{ chapterId, unitId }]
//   onChange — (nextValue) => void
//   compact  — smaller text for the inline grid editor

import { MAX_PLANNED, itemKey as k } from '../lib/plannedItems'

const MAX = MAX_PLANNED

export default function PlannedItemsPicker({ subject, primary, value = [], onChange, compact = false }) {
  if (!subject || !primary?.chapterId) return null
  const items = value || []
  const text = compact ? 'text-xs' : 'text-sm'
  const select = `w-full px-3 py-2 ${text} border border-gray-200 rounded-lg bg-white outline-none focus:ring-2 focus:ring-indigo-400`

  const all = [primary, ...items]
  // Whole chapters already in the class: their units are covered by them.
  const wholeChapterTaken = (chapterId, skip) =>
    all.some((x, i) => i !== skip && String(x.chapterId) === String(chapterId) && !x.unitId)
  const taken = (chapterId, unitId, skip) =>
    all.some((x, i) => i !== skip && k(x.chapterId, x.unitId) === k(chapterId, unitId))

  const set = (i, patch) => onChange(items.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const remove = (i) => onChange(items.filter((_, j) => j !== i))
  const add = () => onChange([...items, { chapterId: '', unitId: '' }])

  return (
    <div className="space-y-2">
      {items.map((it, i) => {
        const idx = i + 1   // position in `all`
        const chap = (subject.chapters || []).find(c => String(c._id) === String(it.chapterId))
        return (
          <div key={i} className="rounded-lg border border-dashed border-indigo-200 bg-indigo-50/30 p-2 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wide text-indigo-500">Also planned #{i + 1}</span>
              <button type="button" onClick={() => remove(i)}
                className="text-gray-400 hover:text-red-500 text-sm leading-none px-1" title="Remove">✕</button>
            </div>
            <select value={it.chapterId || ''}
              onChange={e => set(i, { chapterId: e.target.value, unitId: '' })}
              className={select}>
              <option value="">Chapter…</option>
              {(subject.chapters || []).map(c => {
                // A chapter is out only when it's already in whole AND has no
                // free unit left to add on its own.
                const blocked = taken(c._id, '', idx) && (wholeChapterTaken(c._id, idx) || !(c.units || []).length)
                return (
                  <option key={c._id} value={String(c._id)} disabled={blocked && String(c._id) !== String(it.chapterId)}>
                    {c.completed ? '✓ ' : ''}{c.name}
                  </option>
                )
              })}
            </select>
            {!!chap?.units?.length && (
              <select value={it.unitId || ''}
                onChange={e => set(i, { unitId: e.target.value })}
                className={select}>
                {/* Whole chapter is out while it's already in, or one of its units
                    is picked elsewhere (the chapter would swallow that unit). */}
                <option value="" disabled={taken(chap._id, '', idx)
                  || all.some((x, j) => j !== idx && String(x.chapterId) === String(chap._id) && x.unitId)}>Whole chapter</option>
                {(chap.units || []).map(u => (
                  <option key={u._id} value={String(u._id)}
                    disabled={wholeChapterTaken(chap._id, idx) || taken(chap._id, u._id, idx)}>
                    {u.completed ? '✓ ' : ''}{u.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        )
      })}
      {items.length < MAX && (
        <button type="button" onClick={add}
          className={`${compact ? 'text-[11px]' : 'text-xs'} font-semibold text-indigo-600 hover:underline`}>
          ＋ Add another chapter/unit
        </button>
      )}
      {items.length > 0 && (
        <p className="text-[10px] text-gray-400 leading-relaxed">
          Planned only — the mentor ticks each one they finish after the class. Unfinished ones are not marked done for students.
        </p>
      )}
    </div>
  )
}
