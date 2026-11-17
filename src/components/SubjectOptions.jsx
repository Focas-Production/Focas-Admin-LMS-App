// Subject <option>s grouped level-wise (Foundation → Intermediate → Final) under
// <optgroup> headings, so long subject lists in the scheduler read by level.
const LEVEL_ORDER = ['foundation', 'intermediate', 'final']

const groupTag = g => (g === 'group1' ? 'G1' : g === 'group2' ? 'G2' : '')

export default function SubjectOptions({ subjects, showGroup = false }) {
  const byLevel = new Map()
  for (const s of subjects || []) {
    const level = s.level || 'Other'
    if (!byLevel.has(level)) byLevel.set(level, [])
    byLevel.get(level).push(s)
  }
  const rank = l => {
    const i = LEVEL_ORDER.indexOf(String(l).toLowerCase())
    return i === -1 ? LEVEL_ORDER.length : i
  }
  const levels = [...byLevel.keys()].sort((a, b) => rank(a) - rank(b) || String(a).localeCompare(String(b)))

  return levels.map(level => (
    <optgroup key={level} label={level}>
      {byLevel.get(level).map(s => {
        const tag = showGroup ? groupTag(s.group) : ''
        return (
          <option key={s._id} value={String(s._id)}>
            {s.name}{tag ? ` · ${tag}` : ''}
          </option>
        )
      })}
    </optgroup>
  ))
}
