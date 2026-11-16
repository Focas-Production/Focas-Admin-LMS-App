// One Advanced-filter condition row, shared by the live-class scheduler's
// roster filter and the admin Progress list. `fields` is the field list the
// page offers (defaults to the scheduler's full FIELD_DEFS); the row's shape is
// driven by each field's kind — see lib/rosterFilter.js.
import { FIELD_DEFS, fieldDef, opsFor, newCondition, subjectIdsOf, SLOT_OPTIONS, DAY_TYPES, subjectProgressProblem } from '../lib/rosterFilter'

// One condition row: field → operator → value editor, the editor's shape driven
// by the field's kind (see lib/rosterFilter.js). Changing the field resets the
// row so a stale value can never leak across kinds.
// showProblems: say what's wrong with typed numbers under the row (the
// Progress list's panel shows its own warnings, so it leaves this off).
export default function ConditionRow({ cond, subjects, programs, onChange, onRemove, fields = FIELD_DEFS, showProblems = false }) {
  const def = fieldDef(cond.field, fields)
  if (!def) return null
  const ops = opsFor(def)
  const inputCls = 'px-2 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400 bg-white text-gray-700'

  const chapterSubject = def.kind === 'chapter'
    ? (subjects || []).find(s => String(s._id) === String(cond.value?.subjectId)) || null
    : null
  const chapterChapter = chapterSubject
    ? (chapterSubject.chapters || []).find(c => String(c._id) === String(cond.value?.chapterId)) || null
    : null

  return (
    <div className="border border-gray-100 rounded-xl p-2 bg-gray-50/50">
      <div className="flex items-center gap-1.5">
        <select value={cond.field}
          onChange={e => onChange({ ...newCondition(e.target.value, fields), id: cond.id })}
          className={`${inputCls} flex-1 min-w-0`}>
          {fields.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
        </select>
        <select value={cond.op}
          onChange={e => onChange({ op: e.target.value })}
          className={`${inputCls} flex-1 min-w-0`}>
          {ops.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
        <button onClick={onRemove} className="text-gray-300 hover:text-red-500 flex-shrink-0 px-1">✕</button>
      </div>

      {/* value editor */}
      <div className="mt-1.5">
        {def.kind === 'text' && !['empty', 'not_empty'].includes(cond.op) && (
          <input value={cond.value || ''} onChange={e => onChange({ value: e.target.value })}
            placeholder={`${def.label}…`} className={`${inputCls} w-full`} />
        )}

        {def.kind === 'date' && cond.op === 'last' && (
          <div className="flex items-center gap-1.5">
            <input type="number" min="1" value={cond.value?.days || ''}
              onChange={e => onChange({ value: { days: e.target.value } })}
              className={`${inputCls} w-20`} />
            <span className="text-xs text-gray-500">days</span>
          </div>
        )}
        {def.kind === 'date' && ['before', 'after'].includes(cond.op) && (
          <input type="date" value={cond.value?.date || ''}
            onChange={e => onChange({ value: { date: e.target.value } })}
            className={`${inputCls} w-full`} />
        )}
        {def.kind === 'date' && cond.op === 'between' && (
          <div className="flex items-center gap-1.5">
            <input type="date" value={cond.value?.from || ''}
              onChange={e => onChange({ value: { ...cond.value, from: e.target.value } })}
              className={`${inputCls} flex-1 min-w-0`} />
            <span className="text-xs text-gray-400">–</span>
            <input type="date" value={cond.value?.to || ''}
              onChange={e => onChange({ value: { ...cond.value, to: e.target.value } })}
              className={`${inputCls} flex-1 min-w-0`} />
          </div>
        )}

        {def.kind === 'enum' && cond.op !== 'not_set' && (
          <div className="flex flex-wrap gap-1">
            {def.options.map(o => {
              const on = (cond.value || []).includes(o.key)
              return (
                <button key={o.key}
                  onClick={() => onChange({ value: on ? cond.value.filter(v => v !== o.key) : [...(cond.value || []), o.key] })}
                  className={`text-[10px] font-bold px-2 py-1 rounded-md ${
                    on ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                  {o.label}
                </button>
              )
            })}
          </div>
        )}

        {def.kind === 'program' && cond.op !== 'not_set' && (
          <div className="flex flex-wrap gap-1">
            {programs === null ? (
              <span className="text-[10px] text-gray-400">Loading programs…</span>
            ) : !(programs || []).length ? (
              <span className="text-[10px] text-gray-400">Programs could not be loaded.</span>
            ) : programs.map(p => {
              const id = p.key
              const on = (cond.value || []).includes(id)
              return (
                <button key={id}
                  onClick={() => onChange({ value: on ? cond.value.filter(v => v !== id) : [...(cond.value || []), id] })}
                  className={`text-[10px] font-bold px-2 py-1 rounded-md ${
                    on ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                  {p.name}{p.active ? '' : ' (retired)'}
                </button>
              )
            })}
          </div>
        )}

        {def.kind === 'enrolled' && (() => {
          const { keys = [], subjectIds = [] } = cond.value || {}
          const bySubjects = keys.includes('subjects')
          return (
            <div className="space-y-1.5">
              <div className="flex flex-wrap gap-1">
                {def.options.map(o => {
                  const on = keys.includes(o.key)
                  return (
                    <button key={o.key}
                      // Unticking "Specific subjects" drops its papers too, so a
                      // hidden pick can't come back when it's ticked again.
                      onClick={() => onChange({ value: {
                        keys: on ? keys.filter(v => v !== o.key) : [...keys, o.key],
                        subjectIds: o.key === 'subjects' && on ? [] : subjectIds,
                      } })}
                      className={`text-[10px] font-bold px-2 py-1 rounded-md ${
                        on ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                      {o.label}
                    </button>
                  )
                })}
              </div>
              {bySubjects && (
                <>
                  <p className="text-[10px] text-gray-400">
                    {subjectIds.length
                      ? `Enrolled for any of these ${subjectIds.length} paper${subjectIds.length !== 1 ? 's' : ''}`
                      : 'Tick papers to narrow it — none ticked = any specific subjects'}
                  </p>
                  <SubjectChecklist subjects={subjects} picked={subjectIds}
                    onChange={ids => onChange({ value: { keys, subjectIds: ids } })} />
                </>
              )}
            </div>
          )
        })()}

        {def.kind === 'subject' && (
          <SubjectChecklist subjects={subjects} picked={subjectIdsOf(cond)}
            onChange={ids => onChange({ value: ids })} />
        )}

        {def.kind === 'slot' && (
          <div className="space-y-1.5">
            {cond.op !== 'not_set' && (
              <select value={cond.value?.slot || ''}
                onChange={e => onChange({ value: { ...cond.value, slot: e.target.value } })}
                className={`${inputCls} w-full`}>
                <option value="">Pick a slot…</option>
                {SLOT_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
            )}
            <select value={cond.value?.days || ''}
              onChange={e => onChange({ value: { ...cond.value, days: e.target.value } })}
              className={`${inputCls} w-full`}>
              <option value="">On any day</option>
              {DAY_TYPES.map(d => <option key={d.key} value={d.key}>On {d.long.toLowerCase()}</option>)}
            </select>
          </div>
        )}

        {def.kind === 'subjectProgress' && (() => {
          const v = cond.value || {}
          const set = (patch) => onChange({ value: { ...v, ...patch } })
          const levels = [...new Set((subjects || []).map(s => s.level || 'Other'))]
          const pctBox = (key, placeholder) => (
            <div className="flex items-center gap-1">
              <input type="number" min="0" max="100" step="1" value={v[key] ?? ''} placeholder={placeholder}
                onChange={e => set({ [key]: e.target.value })}
                className={`${inputCls} w-16`} />
              <span className="text-xs text-gray-500">%</span>
            </div>
          )
          return (
            <div className="space-y-1.5">
              <select value={v.subjectId || ''} onChange={e => set({ subjectId: e.target.value })}
                className={`${inputCls} w-full`}>
                <option value="">Pick a subject…</option>
                {/* A saved view can name a paper that has since been retired —
                    say so instead of showing an empty picker. */}
                {v.subjectId && subjects && !subjects.some(x => String(x._id).toLowerCase() === String(v.subjectId).toLowerCase()) && (
                  <option value={v.subjectId}>⚠ Subject no longer active</option>
                )}
                {levels.map(l => (
                  <optgroup key={l} label={l}>
                    {(subjects || []).filter(s => (s.level || 'Other') === l).map(s => (
                      <option key={s._id} value={String(s._id)}>
                        {s.name}{s.group ? ` (${s.group === 'group1' ? 'G1' : 'G2'})` : ''}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {(cond.op === 'below' || cond.op === 'at_least') && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {pctBox('percent', '%')}
                  {[25, 50, 70, 100].map(n => (
                    <button key={n} type="button" onClick={() => set({ percent: String(n) })}
                      className={`text-[10px] font-bold px-2 py-1 rounded-md ${
                        String(v.percent ?? '').trim() === String(n) ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                      {n}%
                    </button>
                  ))}
                </div>
              )}
              {cond.op === 'between' && (
                <div className="flex items-center gap-1.5">
                  {pctBox('min', 'from')}
                  <span className="text-xs text-gray-400">–</span>
                  {pctBox('max', 'to')}
                </div>
              )}
              {showProblems && subjectProgressProblem(cond) && (
                <p className="text-[10px] text-amber-700">⚠ {subjectProgressProblem(cond)} — this row is not applied yet.</p>
              )}
              <p className="text-[10px] text-gray-400">
                % of the paper's topics Done — the same number as the student's report. Students whose report doesn't list this paper are left out (a student outside it with one class booked there counts just those topics, as the report does).
              </p>
            </div>
          )
        })()}

        {def.kind === 'chapter' && (
          <div className="space-y-1.5">
            <select value={cond.value?.subjectId || ''}
              onChange={e => onChange({ value: { subjectId: e.target.value, chapterId: '', unitId: '' } })}
              className={`${inputCls} w-full`}>
              <option value="">Subject…</option>
              {(subjects || []).map(s => <option key={s._id} value={String(s._id)}>{s.name} ({s.level})</option>)}
            </select>
            <select value={cond.value?.chapterId || ''} disabled={!chapterSubject}
              onChange={e => onChange({ value: { ...cond.value, chapterId: e.target.value, unitId: '' } })}
              className={`${inputCls} w-full disabled:bg-gray-50 disabled:text-gray-400`}>
              <option value="">{chapterSubject ? 'Chapter…' : 'Pick subject first'}</option>
              {(chapterSubject?.chapters || []).map(c => (
                <option key={c._id} value={String(c._id)}>{c.completed ? '✓ ' : ''}{c.name}</option>
              ))}
            </select>
            {(chapterChapter?.units || []).length > 0 && (
              <select value={cond.value?.unitId || ''}
                onChange={e => onChange({ value: { ...cond.value, unitId: e.target.value } })}
                className={`${inputCls} w-full`}>
                <option value="">Whole chapter</option>
                {chapterChapter.units.map(u => (
                  <option key={u._id} value={String(u._id)}>{u.completed ? '✓ ' : ''}{u.name}</option>
                ))}
              </select>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// Multi-pick paper list for condition rows; `picked` and onChange's argument
// are arrays of subject id strings.
function SubjectChecklist({ subjects, picked, onChange }) {
  return (
    <div className="space-y-1 max-h-44 overflow-y-auto pr-0.5">
      {(subjects || []).map(s => {
        const id = String(s._id)
        const on = picked.includes(id)
        return (
          <button key={id}
            onClick={() => onChange(on ? picked.filter(v => v !== id) : [...picked, id])}
            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg border text-left text-xs ${
              on ? 'border-indigo-300 bg-indigo-50 text-indigo-800 font-medium' : 'border-gray-100 text-gray-600 hover:bg-gray-50'}`}>
            <span className={`w-3.5 h-3.5 rounded flex items-center justify-center text-[9px] font-bold flex-shrink-0 ${
              on ? 'bg-indigo-600 text-white' : 'border border-gray-300 text-transparent'}`}>✓</span>
            <span className="flex-1 truncate">{s.name}</span>
            <span className="text-[9px] text-gray-400 flex-shrink-0">
              {s.level}{s.group ? ` · ${s.group === 'group1' ? 'G1' : 'G2'}` : ''}
            </span>
          </button>
        )
      })}
    </div>
  )
}
