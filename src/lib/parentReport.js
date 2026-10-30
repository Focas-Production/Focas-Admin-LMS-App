// The parent WhatsApp report as the parent reads it — mirrors the approved
// template text in server/PARENT_REPORTS_SETUP.md and the variables built in
// server/services/parentReportService.js (messageParams). Used for previews
// only; the real message is the WhatsApp template.
// '919876543210' → '98765 43210' for Indian numbers; others as +<digits>.
export const showPhone = (p) => (p && /^91\d{10}$/.test(p) ? `${p.slice(2, 7)} ${p.slice(7)}` : p ? `+${p}` : '')

const word = (n, one, many) => `${n} ${n === 1 ? one : many}`

export function reportParams(kind, studentName, periodLabel, st, contact = '') {
  return {
    student: studentName || 'your child',
    period: kind,
    dates: periodLabel,
    classes: `${st.period.attended} of ${st.period.held} (${st.period.percent}%)`,
    work: `${st.period.workSubmitted} of ${word(st.period.held, 'class', 'classes')}`,
    overall_attendance: `${st.overall.percent}% (${st.overall.attended} of ${word(st.overall.held, 'class', 'classes')})`,
    overall_work: `${st.overall.workSubmitted} of ${word(st.overall.held, 'class', 'classes')}`,
    progress: st.syllabus.chaptersTotal
      ? `${st.syllabus.percent}% (${st.syllabus.chaptersDone} of ${word(st.syllabus.chaptersTotal, 'chapter', 'chapters')})`
      : 'not started yet',
    contact: contact || '(contact number not set)',
  }
}

export function reportMessage(kind, studentName, periodLabel, st, contact) {
  const p = reportParams(kind, studentName, periodLabel, st, contact)
  return `*FOCAS Edu – Student Progress Report*

Dear Parent,

Greetings from FOCAS Edu! Here is the ${p.period} progress report of *${p.student}* for *${p.dates}*.

*📊 This Period*
• *Classes attended:* ${p.classes}
• *Class work submitted:* ${p.work}

*📈 Overall (Current Batch)*
• *Attendance:* ${p.overall_attendance}
• *Class work submitted:* ${p.overall_work}
• *Syllabus completed:* ${p.progress}

Please encourage your child to attend every class, submit class work on time and study regularly at home. If your child needs any extra help or support, we are always here for you.

For any questions or support, please call or WhatsApp us at *${p.contact}*.

Warm regards,
*Team FOCAS Edu*`
}
