import { useState, useEffect } from 'react'
import { apiFetch } from '../../api'

// Admin: AI question settings only.
//
// Extraction, upload and draft review used to live here. They now run entirely on the
// server (server/scripts/importQuestionBanks.js reading server/question-banks/), so the
// admin app keeps just the one thing that has to be editable at runtime — the monthly
// generation limits.

export default function AiQuestionBankPage() {
  const [toast, setToast] = useState('')
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 4000) }

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto">
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-gray-900 text-white text-sm px-4 py-2.5 rounded-xl shadow-lg">{toast}</div>
      )}

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">AI Question Bank</h1>
        <p className="text-gray-400 text-sm mt-1">
          Settings for the AI similar-question feature. Questions themselves are imported on the
          server from <code className="text-gray-500">server/question-banks/</code>.
        </p>
      </div>

      <LimitsPanel showToast={showToast} />
    </div>
  )
}

// ── Admin-configurable monthly generation limits (Lite / Pro) ──
function LimitsPanel({ showToast }) {
  const [lite, setLite]     = useState('')
  const [pro, setPro]       = useState('')
  const [orig, setOrig]     = useState({ lite: '', pro: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    apiFetch('/api/admin/settings').then(s => {
      const l = String(s?.aiGen?.liteMonthlyLimit ?? 10)
      const p = String(s?.aiGen?.proMonthlyLimit ?? 50)
      setLite(l); setPro(p); setOrig({ lite: l, pro: p })
    }).catch(() => {})
  }, [])

  const dirty = lite !== orig.lite || pro !== orig.pro

  const save = async () => {
    setSaving(true)
    try {
      await apiFetch('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({ aiGen: { liteMonthlyLimit: Number(lite), proMonthlyLimit: Number(pro) } }),
      })
      setOrig({ lite, pro })
      showToast('AI generation limits saved')
    } catch (e) { showToast(e.message) } finally { setSaving(false) }
  }

  const inp = 'w-28 px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400'
  return (
    <section className="bg-white rounded-2xl shadow-sm p-5 mb-6">
      <h2 className="font-bold text-gray-900 mb-1">Monthly Generation Limits</h2>
      <p className="text-xs text-gray-400 mb-4">
        How many AI questions a student may generate per calendar month. A student is <strong>Pro</strong> if they own
        any product marked AI&nbsp;Pro, otherwise <strong>Lite</strong>. Usage resets automatically each month.
        Set 0 to disable a tier. Individual students can be given a higher limit on the Users page.
      </p>
      <div className="flex flex-wrap items-end gap-5">
        <label className="block">
          <span className="block text-xs font-semibold text-sky-700 mb-1">Lite — per month</span>
          <input type="number" min="0" value={lite} onChange={e => setLite(e.target.value)} className={inp} />
        </label>
        <label className="block">
          <span className="block text-xs font-semibold text-violet-700 mb-1">Pro — per month</span>
          <input type="number" min="0" value={pro} onChange={e => setPro(e.target.value)} className={inp} />
        </label>
        <button onClick={save} disabled={!dirty || saving}
          className="px-5 py-2 rounded-xl bg-indigo-600 text-white font-semibold text-sm hover:bg-indigo-700 disabled:bg-gray-200 disabled:text-gray-400">
          {saving ? 'Saving…' : 'Save Limits'}
        </button>
      </div>
    </section>
  )
}
