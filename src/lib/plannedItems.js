// Helpers for a class's planned extra chapters/units (see components/PlannedItemsPicker.jsx).

export const MAX_PLANNED = 10
export const itemKey = (c, u) => `${c || ''}|${u || ''}`
const k = itemKey

// Problems the admin must fix before saving, or '' when fine.
export function plannedItemsError(subject, primary, items) {
  const list = items || []
  if (!list.length) return ''
  if (list.some(x => !x.chapterId)) return 'Pick a chapter for each extra row (or remove it)'
  const keys = [k(primary?.chapterId, primary?.unitId), ...list.map(x => k(x.chapterId, x.unitId))]
  if (new Set(keys).size !== keys.length) return 'The same chapter/unit is picked twice'
  const whole = new Set([primary, ...list].filter(x => !x.unitId).map(x => String(x.chapterId)))
  if (list.some(x => x.unitId && whole.has(String(x.chapterId))) || (primary?.unitId && whole.has(String(primary.chapterId)))) {
    return 'A unit is picked together with its whole chapter — keep one'
  }
  return ''
}

// Payload shape for the API: drops blanks.
export const plannedPayload = (items) =>
  (items || []).filter(x => x.chapterId).map(x => ({ chapterId: x.chapterId, unitId: x.unitId || undefined }))

// "Chapter · Unit" names for display, off the subject tree.
export function plannedNames(subject, items) {
  return (items || []).filter(x => x.chapterId).map(x => {
    const c = (subject?.chapters || []).find(ch => String(ch._id) === String(x.chapterId))
    const u = (c?.units || []).find(un => String(un._id) === String(x.unitId))
    return u ? `${c?.name} · ${u.name}` : (c?.name || '…')
  })
}

// Same, off a saved class's denormalised plannedItems.
export const savedPlannedNames = (cls) =>
  (cls?.plannedItems || []).map(x => x.unit?.name ? `${x.chapter?.name} · ${x.unit.name}` : (x.chapter?.name || ''))
    .filter(Boolean)
