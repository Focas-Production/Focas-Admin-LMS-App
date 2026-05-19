import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '../../api'

// ── Constants ─────────────────────────────────────────────────────────────────

const SOURCES = ['all', 'website', 'shopify', 'combo', 'custom']

const SOURCE_STYLE = {
  website: 'bg-blue-100 text-blue-700',
  shopify: 'bg-green-100 text-green-700',
  combo:   'bg-purple-100 text-purple-700',
  custom:  'bg-orange-100 text-orange-700',
}

const FULFILLMENT_STYLE = {
  unfulfilled: 'bg-red-100 text-red-600',
  partial:     'bg-yellow-100 text-yellow-700',
  fulfilled:   'bg-green-100 text-green-700',
  restocked:   'bg-gray-100 text-gray-600',
}

function fmtINR(n) {
  if (!n) return '₹0'
  return `₹${Number(n).toLocaleString('en-IN')}`
}

// ── Detail Drawer ─────────────────────────────────────────────────────────────

function DetailDrawer({ purchaseId, onClose }) {
  const [purchase, setPurchase] = useState(null)
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    if (!purchaseId) return
    apiFetch(`/api/admin/purchases/${purchaseId}`)
      .then(d => setPurchase(d.purchase))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [purchaseId])

  const total = (purchase?.items || []).reduce((s, i) => s + (i.amount || 0), 0)

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-md bg-white shadow-2xl flex flex-col overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
          <h2 className="font-bold text-gray-900">Order Details</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
          </div>
        ) : !purchase ? (
          <p className="p-5 text-gray-400 text-center">Order not found.</p>
        ) : (
          <div className="p-5 space-y-5">
            {/* Status badges */}
            <div className="flex gap-2 flex-wrap">
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${SOURCE_STYLE[purchase.source] || 'bg-gray-100 text-gray-600'}`}>
                {purchase.source}
              </span>
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${FULFILLMENT_STYLE[purchase.fulfillmentStatus] || 'bg-gray-100 text-gray-600'}`}>
                {purchase.fulfillmentStatus}
              </span>
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${purchase.status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                {purchase.status}
              </span>
            </div>

            {/* Order info */}
            <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
              <Row label="Order ID"   value={<span className="font-mono text-xs">{purchase.orderId}</span>} />
              <Row label="Date"       value={new Date(purchase.createdAt).toLocaleString('en-IN')} />
              <Row label="Total"      value={<span className="font-bold text-gray-900">{fmtINR(total)}</span>} />
            </div>

            {/* Customer */}
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Customer</h3>
              <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
                <Row label="Name"  value={purchase.customerName || purchase.userId?.name || '—'} />
                <Row label="Phone" value={purchase.customerPhone || purchase.userId?.phoneNumber || '—'} />
                <Row label="Email" value={purchase.userId?.email || '—'} />
              </div>
            </div>

            {/* Items */}
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Items</h3>
              <div className="space-y-2">
                {(purchase.items || []).map((item, i) => (
                  <div key={i} className="bg-gray-50 rounded-xl p-3 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{item.name || item.productId?.name || 'Product'}</p>
                      {item.level && <p className="text-xs text-gray-400">{item.level}</p>}
                    </div>
                    <span className="text-sm font-semibold text-gray-900 flex-shrink-0">{fmtINR(item.amount)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Address */}
            {purchase.address?.line1 && (
              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Delivery Address</h3>
                <div className="bg-gray-50 rounded-xl p-4 text-sm text-gray-700">
                  <p>{purchase.address.line1}</p>
                  {purchase.address.line2 && <p>{purchase.address.line2}</p>}
                  <p>{[purchase.address.city, purchase.address.state, purchase.address.pincode].filter(Boolean).join(', ')}</p>
                </div>
              </div>
            )}

            {/* Shipment */}
            {purchase.shipment?.awb && (
              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Shipment</h3>
                <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
                  <Row label="AWB"    value={<span className="font-mono text-xs">{purchase.shipment.awb}</span>} />
                  <Row label="Status" value={purchase.shipment.trackingStatus || '—'} />
                </div>
              </div>
            )}

            {/* Notes */}
            {purchase.notes && (
              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Admin Notes</h3>
                <p className="bg-yellow-50 border border-yellow-100 rounded-xl p-4 text-sm text-gray-700">{purchase.notes}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-gray-400 flex-shrink-0">{label}</span>
      <span className="text-gray-900 text-right">{value}</span>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function PurchasesPage() {
  const [purchases, setPurchases] = useState([])
  const [total,     setTotal]     = useState(0)
  const [page,      setPage]      = useState(1)
  const [loading,   setLoading]   = useState(true)
  const [selected,  setSelected]  = useState(null)

  // Filters
  const [source,      setSource]      = useState('all')
  const [fulfillment, setFulfillment] = useState('all')
  const [search,      setSearch]      = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [dateFrom,    setDateFrom]    = useState('')
  const [dateTo,      setDateTo]      = useState('')

  const LIMIT = 15

  const load = useCallback(() => {
    setLoading(true)
    const q = new URLSearchParams({ page, limit: LIMIT })
    if (source      !== 'all') q.set('source', source)
    if (fulfillment !== 'all') q.set('fulfillmentStatus', fulfillment)
    if (dateFrom)              q.set('dateFrom', dateFrom)
    if (dateTo)                q.set('dateTo', dateTo)
    if (search) {
      if (/^\d{6,}$/.test(search)) q.set('phone', search)
      else q.set('orderId', search)
    }
    apiFetch(`/api/admin/purchases?${q}`)
      .then(d => { setPurchases(d.purchases || []); setTotal(d.pagination?.total || 0) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [page, source, fulfillment, search, dateFrom, dateTo])

  useEffect(() => { load() }, [load])

  function handleSearch(e) {
    e.preventDefault()
    setPage(1)
    setSearch(searchInput)
  }

  function resetFilters() {
    setSource('all'); setFulfillment('all')
    setSearch(''); setSearchInput('')
    setDateFrom(''); setDateTo(''); setPage(1)
  }

  const totalPages = Math.ceil(total / LIMIT)

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Purchases</h1>
          <p className="text-gray-400 text-sm mt-0.5">{total} total orders</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl shadow-sm p-4 mb-5 space-y-3">
        {/* Source tabs */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {SOURCES.map(s => (
            <button key={s} onClick={() => { setSource(s); setPage(1) }}
              className={`flex-shrink-0 px-3.5 py-1.5 rounded-full text-sm font-medium transition-colors capitalize ${
                source === s ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}>
              {s}
            </button>
          ))}
        </div>

        {/* Row 2: fulfillment + date + search */}
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-xs text-gray-400 block mb-1">Fulfillment</label>
            <select value={fulfillment} onChange={e => { setFulfillment(e.target.value); setPage(1) }}
              className="text-sm border border-gray-200 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
              <option value="all">All status</option>
              <option value="unfulfilled">Unfulfilled</option>
              <option value="partial">Partial</option>
              <option value="fulfilled">Fulfilled</option>
              <option value="restocked">Restocked</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">From</label>
            <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1) }}
              className="text-sm border border-gray-200 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">To</label>
            <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1) }}
              className="text-sm border border-gray-200 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <form onSubmit={handleSearch} className="flex gap-2 flex-1 min-w-[200px]">
            <div className="relative flex-1">
              <svg className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input type="text" value={searchInput} onChange={e => setSearchInput(e.target.value)}
                placeholder="Order ID or phone..."
                className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <button type="submit" className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700">Search</button>
          </form>
          {(source !== 'all' || fulfillment !== 'all' || search || dateFrom || dateTo) && (
            <button onClick={resetFilters} className="text-sm text-gray-400 hover:text-gray-600 flex items-center gap-1">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-5 py-3.5 text-gray-500 font-medium text-xs uppercase tracking-wide">Order ID</th>
                <th className="text-left px-5 py-3.5 text-gray-500 font-medium text-xs uppercase tracking-wide">Customer</th>
                <th className="text-left px-5 py-3.5 text-gray-500 font-medium text-xs uppercase tracking-wide">Items</th>
                <th className="text-left px-5 py-3.5 text-gray-500 font-medium text-xs uppercase tracking-wide">Amount</th>
                <th className="text-left px-5 py-3.5 text-gray-500 font-medium text-xs uppercase tracking-wide">Source</th>
                <th className="text-left px-5 py-3.5 text-gray-500 font-medium text-xs uppercase tracking-wide">Fulfillment</th>
                <th className="text-left px-5 py-3.5 text-gray-500 font-medium text-xs uppercase tracking-wide">Date</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array(6).fill(0).map((_, i) => (
                  <tr key={i} className="border-t border-gray-50">
                    {Array(7).fill(0).map((_, j) => (
                      <td key={j} className="px-5 py-4"><div className="h-4 bg-gray-100 rounded animate-pulse w-20" /></td>
                    ))}
                  </tr>
                ))
              ) : purchases.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-gray-400">
                    <svg className="w-12 h-12 mx-auto mb-3 text-gray-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                    </svg>
                    No orders found
                  </td>
                </tr>
              ) : (
                purchases.map(p => {
                  const amount = (p.items || []).reduce((s, i) => s + (i.amount || 0), 0)
                  return (
                    <tr key={p._id} onClick={() => setSelected(p._id)}
                      className="border-t border-gray-50 hover:bg-indigo-50/40 cursor-pointer transition-colors">
                      <td className="px-5 py-3.5">
                        <span className="font-mono text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                          {p.orderId?.slice(-12) || '—'}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <p className="font-medium text-gray-900">{p.customerName || p.userId?.name || '—'}</p>
                        <p className="text-xs text-gray-400">{p.customerPhone || p.userId?.phoneNumber || ''}</p>
                      </td>
                      <td className="px-5 py-3.5 max-w-[180px]">
                        <p className="text-gray-700 truncate text-xs">{(p.items || []).map(i => i.name).join(', ') || '—'}</p>
                        <p className="text-xs text-gray-400">{p.items?.length || 0} item{p.items?.length !== 1 ? 's' : ''}</p>
                      </td>
                      <td className="px-5 py-3.5 font-semibold text-gray-900">{fmtINR(amount)}</td>
                      <td className="px-5 py-3.5">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${SOURCE_STYLE[p.source] || 'bg-gray-100 text-gray-600'}`}>
                          {p.source}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${FULFILLMENT_STYLE[p.fulfillmentStatus] || 'bg-gray-100 text-gray-600'}`}>
                          {p.fulfillmentStatus}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-gray-400 text-xs whitespace-nowrap">
                        {new Date(p.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3.5 border-t border-gray-100">
            <p className="text-sm text-gray-400">
              Showing {(page - 1) * LIMIT + 1}–{Math.min(page * LIMIT, total)} of {total}
            </p>
            <div className="flex gap-1">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50">‹</button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const pg = page <= 3 ? i + 1 : page - 2 + i
                if (pg > totalPages) return null
                return (
                  <button key={pg} onClick={() => setPage(pg)}
                    className={`px-3 py-1.5 text-sm rounded-lg border ${pg === page ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-200 hover:bg-gray-50'}`}>
                    {pg}
                  </button>
                )
              })}
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50">›</button>
            </div>
          </div>
        )}
      </div>

      {/* Detail Drawer */}
      {selected && <DetailDrawer purchaseId={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
