import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../../api'

// ── Helpers ──────────────────────────────────────────────────────────────────

function getLast7Days() {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (6 - i))
    d.setHours(0, 0, 0, 0)
    return d
  })
}

function fmtINR(n) {
  if (n == null) return '—'
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`
  if (n >= 1000)   return `₹${(n / 1000).toFixed(1)}K`
  return `₹${Math.round(n)}`
}

function fmtDate(d) {
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

// ── Mini Revenue Chart (SVG) ──────────────────────────────────────────────────

function RevenueChart({ data }) {
  const W = 480, H = 110, PL = 10, PR = 10, PT = 10, PB = 30
  const chartW = W - PL - PR
  const chartH = H - PT - PB
  const maxVal = Math.max(...data.map(d => d.revenue), 1)
  const pts = data.map((d, i) => ({
    x: PL + (i / (data.length - 1)) * chartW,
    y: PT + chartH - (d.revenue / maxVal) * chartH,
    ...d,
  }))
  const polyline = pts.map(p => `${p.x},${p.y}`).join(' ')
  const area = `${pts[0].x},${PT + chartH} ${polyline} ${pts[pts.length - 1].x},${PT + chartH}`

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
      {/* Grid lines */}
      {[0, 0.5, 1].map(t => (
        <line key={t}
          x1={PL} x2={W - PR}
          y1={PT + chartH - t * chartH} y2={PT + chartH - t * chartH}
          stroke="#e5e7eb" strokeWidth="1" strokeDasharray="4 3" />
      ))}
      {/* Area fill */}
      <polygon points={area} fill="url(#grad)" opacity="0.25" />
      {/* Line */}
      <polyline points={polyline} fill="none" stroke="#4f46e5" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {/* Dots */}
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="3.5" fill="#4f46e5" stroke="white" strokeWidth="2" />
      ))}
      {/* X labels */}
      {pts.map((p, i) => (
        <text key={i} x={p.x} y={H - 6} textAnchor="middle" fontSize="9" fill="#9ca3af">
          {p.label}
        </text>
      ))}
      <defs>
        <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4f46e5" />
          <stop offset="100%" stopColor="#4f46e5" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  )
}

// ── Stat Card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, icon, color, sub }) {
  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${color}`}>
        {icon}
      </div>
      <p className="text-2xl font-bold text-gray-900">{value ?? '—'}</p>
      <p className="text-sm text-gray-500 mt-0.5">{label}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  )
}

// ── Source badge ──────────────────────────────────────────────────────────────

const SOURCE_STYLE = {
  website: 'bg-blue-100 text-blue-700',
  shopify: 'bg-green-100 text-green-700',
  combo:   'bg-purple-100 text-purple-700',
  custom:  'bg-orange-100 text-orange-700',
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const navigate = useNavigate()
  const [summary,   setSummary]   = useState(null)
  const [chartData, setChartData] = useState([])
  const [users,     setUsers]     = useState(0)
  const [products,  setProducts]  = useState(0)
  const [recent,    setRecent]    = useState([])
  const [loading,   setLoading]   = useState(true)

  useEffect(() => {
    const days   = getLast7Days()
    const dateFrom = days[0].toISOString().split('T')[0]
    const dateTo   = days[6].toISOString().split('T')[0]

    Promise.all([
      apiFetch('/api/admin/sales/summary'),
      apiFetch(`/api/admin/sales/timeline?groupBy=day&dateFrom=${dateFrom}&dateTo=${dateTo}`),
      apiFetch('/api/admin/users?limit=1'),
      apiFetch('/api/admin/products?limit=1'),
      apiFetch('/api/admin/purchases?limit=5'),
    ])
      .then(([sumRes, timeRes, usrRes, prodRes, purchRes]) => {
        setSummary(sumRes)
        setUsers(usrRes.pagination?.total || 0)
        setProducts(prodRes.pagination?.total || 0)
        setRecent(purchRes.purchases || [])

        // Map timeline to 7 fixed days
        const timelineMap = {}
        for (const t of timeRes.timeline || []) {
          const key = `${t._id?.year}-${String(t._id?.month).padStart(2,'0')}-${String(t._id?.day).padStart(2,'0')}`
          timelineMap[key] = t.totalRevenue || 0
        }
        const chart = days.map(d => {
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
          return { label: fmtDate(d), revenue: timelineMap[key] || 0 }
        })
        setChartData(chart)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-400 text-sm mt-0.5">
          {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Revenue"
          value={summary ? fmtINR(summary.totalRevenue) : '—'}
          color="bg-green-100"
          icon={<svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
        />
        <StatCard
          label="Total Orders"
          value={summary?.totalOrders}
          color="bg-blue-100"
          icon={<svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" /></svg>}
        />
        <StatCard
          label="Total Users"
          value={users}
          color="bg-purple-100"
          icon={<svg className="w-5 h-5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>}
        />
        <StatCard
          label="Total Products"
          value={products}
          color="bg-orange-100"
          icon={<svg className="w-5 h-5 text-orange-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>}
        />
      </div>

      {/* Chart */}
      <div className="bg-white rounded-2xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-semibold text-gray-900">Revenue — Last 7 Days</h2>
            <p className="text-xs text-gray-400 mt-0.5">Daily sales revenue</p>
          </div>
          {chartData.length > 0 && (
            <p className="text-sm font-semibold text-indigo-600">
              {fmtINR(chartData.reduce((s, d) => s + d.revenue, 0))}
            </p>
          )}
        </div>
        {loading ? (
          <div className="h-28 bg-gray-50 rounded-xl animate-pulse" />
        ) : (
          <RevenueChart data={chartData} />
        )}
      </div>

      {/* Recent Purchases */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Recent Orders</h2>
          <button onClick={() => navigate('/admin/purchases')}
            className="text-sm text-indigo-600 hover:text-indigo-800 font-medium">
            View all →
          </button>
        </div>
        {loading ? (
          <div className="p-5 space-y-3">
            {[1,2,3].map(i => <div key={i} className="h-10 bg-gray-50 rounded-xl animate-pulse" />)}
          </div>
        ) : recent.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-gray-400">No orders yet</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50">
                <th className="text-left px-5 py-3 text-gray-500 font-medium text-xs uppercase tracking-wide">Order</th>
                <th className="text-left px-5 py-3 text-gray-500 font-medium text-xs uppercase tracking-wide">Customer</th>
                <th className="text-left px-5 py-3 text-gray-500 font-medium text-xs uppercase tracking-wide">Source</th>
                <th className="text-left px-5 py-3 text-gray-500 font-medium text-xs uppercase tracking-wide">Amount</th>
                <th className="text-left px-5 py-3 text-gray-500 font-medium text-xs uppercase tracking-wide">Date</th>
              </tr>
            </thead>
            <tbody>
              {recent.map(p => {
                const amount = (p.items || []).reduce((s, i) => s + (i.amount || 0), 0)
                return (
                  <tr key={p._id} onClick={() => navigate('/admin/purchases')}
                    className="border-t border-gray-50 hover:bg-gray-50 cursor-pointer transition-colors">
                    <td className="px-5 py-3 font-mono text-xs text-gray-600">{p.orderId?.slice(-10) || '—'}</td>
                    <td className="px-5 py-3">
                      <p className="font-medium text-gray-900 text-sm">{p.customerName || p.userId?.name || '—'}</p>
                      <p className="text-xs text-gray-400">{p.customerPhone || p.userId?.phoneNumber || ''}</p>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${SOURCE_STYLE[p.source] || 'bg-gray-100 text-gray-600'}`}>
                        {p.source}
                      </span>
                    </td>
                    <td className="px-5 py-3 font-semibold text-gray-900">{fmtINR(amount)}</td>
                    <td className="px-5 py-3 text-gray-400 text-xs">
                      {new Date(p.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
