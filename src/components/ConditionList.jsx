// The Advanced filter's condition rows with AND / OR at every gap — shared by
// the live-class scheduler's roster filter and the admin Progress list.
// AND binds tighter than OR, so rows joined by AND sit together in one box and
// each OR starts a new box: "(1 AND 2) OR 3" reads straight off the screen.
//
//   conditions / setConditions  the rows (each after the first has `join`)
//   fields       the field list the page offers (ConditionRow)
//   isComplete   (row) → does it apply? (drives the formula line)
//   rowProblem   (row) → warning text or null, shown under the row (optional)
//   showProblems let ConditionRow show its own number warnings instead
//   newFieldKey  field a new row starts on
import { newCondition, groupConditions, describeFilter, removeConditionAt, JOINS } from '../lib/rosterFilter'
import ConditionRow from './FilterConditionRow'

export const MAX_ROWS = 20

export default function ConditionList({
  conditions, setConditions, fields, subjects, programs,
  isComplete, rowProblem = null, showProblems = false, newFieldKey, max = MAX_ROWS,
}) {
  const patchCondition = (id, patch) =>
    setConditions(conditions.map(c => (c.id === id ? { ...c, ...patch } : c)))
  const removeCondition = (id) => setConditions(removeConditionAt(conditions, id))
  const flipJoin = (id) =>
    setConditions(conditions.map(c => (c.id === id ? { ...c, join: c.join === 'or' ? 'and' : 'or' } : c)))
  const atLimit = conditions.length >= max
  const addCondition = (join) => {
    if (atLimit) return
    setConditions([...conditions, { ...newCondition(newFieldKey, fields), join }])
  }
  const groups = groupConditions(conditions)
  const summary = describeFilter(conditions, isComplete)

  return (
    <div>
      <p className="text-[10px] font-bold text-gray-400 uppercase mb-1.5">Conditions</p>
      {conditions.length > 1 && (
        <div className="mb-2 rounded-lg bg-gray-50 border border-gray-100 px-2.5 py-1.5">
          <p className="text-[11px] text-gray-500">
            Shows students matching{' '}
            <b className="text-gray-800 font-mono">{summary || '—'}</b>
          </p>
          <p className="text-[10px] text-gray-400 mt-0.5">
            Click AND / OR between rows to switch it. AND rows are checked together first, then OR.
          </p>
        </div>
      )}
      {!conditions.length && (
        <p className="text-xs text-gray-400 mb-2">No conditions yet — add one below.</p>
      )}
      {groups.map((g, gi) => (
        <div key={g[0].c.id}>
          {gi > 0 && (
            <div className="flex items-center gap-2 my-2">
              <div className="flex-1 h-px bg-amber-200" />
              <JoinPill join="or" onClick={() => flipJoin(g[0].c.id)} />
              <div className="flex-1 h-px bg-amber-200" />
            </div>
          )}
          <div className={groups.length > 1 ? 'rounded-xl border border-indigo-100 bg-indigo-50/30 p-1.5' : ''}>
            {g.map(({ c, i }, k) => (
              <div key={c.id}>
                {k > 0 && (
                  <div className="flex justify-center my-1">
                    <JoinPill join="and" onClick={() => flipJoin(c.id)} />
                  </div>
                )}
                <div className="flex items-start gap-1.5">
                  <span className="mt-2.5 w-5 h-5 flex-shrink-0 rounded-full bg-white border border-gray-200 text-[10px] font-bold text-gray-500 flex items-center justify-center">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <ConditionRow cond={c} subjects={subjects} programs={programs} fields={fields} showProblems={showProblems}
                      onChange={patch => patchCondition(c.id, patch)}
                      onRemove={() => removeCondition(c.id)} />
                    {rowProblem && rowProblem(c) && (
                      <p className="text-[10px] text-amber-700 mt-1">⚠ {rowProblem(c)} — this row is not applied yet.</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
      {atLimit && (
        <p className="text-[10px] text-gray-400 mt-2">Up to {max} conditions.</p>
      )}
      <div className={`flex items-center gap-4 mt-2 ${atLimit ? 'hidden' : ''}`}>
        <button onClick={() => addCondition('and')}
          className="text-xs font-semibold text-indigo-600 hover:text-indigo-800">
          + {conditions.length ? 'AND condition' : 'Add condition'}
        </button>
        {conditions.length > 0 && (
          <button onClick={() => addCondition('or')}
            className="text-xs font-semibold text-amber-700 hover:text-amber-900">
            + OR condition
          </button>
        )}
      </div>
    </div>
  )
}

// The joiner between two rows; click flips it AND ↔ OR.
function JoinPill({ join, onClick }) {
  return (
    <button type="button" onClick={onClick}
      title={join === 'and' ? 'Both rows must match — click to make it OR' : 'Either side may match — click to make it AND'}
      className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border transition-colors ${
        join === 'and'
          ? 'border-indigo-200 bg-white text-indigo-600 hover:bg-indigo-50'
          : 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100'}`}>
      {JOINS[join]}
    </button>
  )
}
