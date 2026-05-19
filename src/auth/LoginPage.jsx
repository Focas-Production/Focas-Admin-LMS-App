import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from './AuthContext'

const API_BASE = import.meta.env.VITE_API_BASE

export default function LoginPage() {
  const { login } = useAuth()
  const navigate   = useNavigate()

  const [tab, setTab]             = useState('phone')
  const [identifier, setIdentifier] = useState('')
  const [step, setStep]           = useState('input')
  const [otp, setOtp]             = useState(['', '', '', '', '', ''])
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')
  const [resendTimer, setResendTimer] = useState(0)
  const otpRefs  = useRef([])
  const timerRef = useRef(null)

  useEffect(() => () => clearInterval(timerRef.current), [])

  function startResendTimer() {
    setResendTimer(30)
    timerRef.current = setInterval(() => {
      setResendTimer(prev => {
        if (prev <= 1) { clearInterval(timerRef.current); return 0 }
        return prev - 1
      })
    }, 1000)
  }

  async function sendOTP(e) {
    e?.preventDefault()
    setError('')
    if (!identifier.trim()) { setError(tab === 'phone' ? 'Enter your phone number' : 'Enter your email'); return }
    setLoading(true)
    try {
      const body = tab === 'phone' ? { phoneNumber: identifier.trim() } : { email: identifier.trim() }
      const res  = await fetch(`${API_BASE}/api/auth/send-otp`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to send OTP')
      setStep('otp')
      setOtp(['', '', '', '', '', ''])
      startResendTimer()
      setTimeout(() => otpRefs.current[0]?.focus(), 100)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function verifyOTP(e) {
    e.preventDefault()
    setError('')
    const code = otp.join('')
    if (code.length !== 6) { setError('Enter the 6-digit OTP'); return }
    setLoading(true)
    try {
      const body = tab === 'phone'
        ? { phoneNumber: identifier.trim(), otp: code }
        : { email: identifier.trim(), otp: code }
      const res  = await fetch(`${API_BASE}/api/auth/verify-otp`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Verification failed')

      if (!data.user.isAdmin) {
        setError('Access denied. This portal is for admins only.')
        setLoading(false)
        return
      }

      login(data.user, data.token)
      navigate('/admin', { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function handleOtpChange(i, v) {
    if (!/^\d*$/.test(v)) return
    const updated = [...otp]; updated[i] = v.slice(-1); setOtp(updated)
    if (v && i < 5) otpRefs.current[i + 1]?.focus()
  }

  function handleOtpKeyDown(i, e) {
    if (e.key === 'Backspace' && !otp[i] && i > 0) otpRefs.current[i - 1]?.focus()
  }

  function handleOtpPaste(e) {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (pasted.length) {
      const updated = Array(6).fill('').map((_, i) => pasted[i] || '')
      setOtp(updated)
      otpRefs.current[Math.min(pasted.length, 5)]?.focus()
    }
    e.preventDefault()
  }

  const masked = tab === 'phone'
    ? identifier.replace(/(\d{2})\d+(\d{2})/, '$1****$2')
    : identifier.replace(/(.{2}).*(@.*)/, '$1****$2')

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-indigo-500 rounded-2xl mb-4 shadow-lg">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white">FOCAS Admin</h1>
          <p className="text-slate-400 text-sm mt-1">Admin portal — restricted access</p>
        </div>

        <div className="bg-white rounded-3xl shadow-2xl p-8">
          {step === 'input' ? (
            <>
              <h2 className="text-xl font-semibold text-gray-800 mb-1">Admin Sign In</h2>
              <p className="text-gray-400 text-sm mb-6">Enter your registered phone or email</p>

              <div className="flex bg-gray-100 rounded-xl p-1 mb-5">
                {['phone', 'email'].map(t => (
                  <button key={t} type="button"
                    onClick={() => { setTab(t); setIdentifier(''); setError('') }}
                    className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all capitalize ${
                      tab === t ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500'
                    }`}>{t}</button>
                ))}
              </div>

              <form onSubmit={sendOTP}>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {tab === 'phone' ? 'Phone Number' : 'Email Address'}
                </label>
                {tab === 'phone' ? (
                  <div className="flex border border-gray-200 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-indigo-500 focus-within:border-transparent">
                    <span className="flex items-center px-3 bg-gray-50 text-gray-500 text-sm border-r border-gray-200">+91</span>
                    <input type="tel" value={identifier} autoFocus
                      onChange={e => setIdentifier(e.target.value.replace(/\D/g, '').slice(0, 10))}
                      placeholder="10-digit mobile" className="flex-1 px-3 py-3 text-sm outline-none" />
                  </div>
                ) : (
                  <input type="email" value={identifier} autoFocus
                    onChange={e => setIdentifier(e.target.value)} placeholder="admin@example.com"
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
                )}
                {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
                <button type="submit" disabled={loading}
                  className="mt-5 w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-semibold py-3 rounded-xl transition-colors flex items-center justify-center gap-2">
                  {loading ? <><Spinner />Sending...</> : 'Send OTP'}
                </button>
              </form>
            </>
          ) : (
            <>
              <button onClick={() => { setStep('input'); setError('') }}
                className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 mb-5">← Back</button>
              <h2 className="text-xl font-semibold text-gray-800 mb-1">Enter OTP</h2>
              <p className="text-gray-400 text-sm mb-6">
                6-digit code sent to <span className="font-medium text-gray-700">{masked}</span>
              </p>
              <form onSubmit={verifyOTP}>
                <div className="flex gap-2 justify-between mb-2" onPaste={handleOtpPaste}>
                  {otp.map((d, i) => (
                    <input key={i} ref={el => otpRefs.current[i] = el}
                      type="text" inputMode="numeric" maxLength={1} value={d}
                      onChange={e => handleOtpChange(i, e.target.value)}
                      onKeyDown={e => handleOtpKeyDown(i, e)}
                      className={`w-12 h-12 text-center text-xl font-bold border-2 rounded-xl outline-none transition-all ${
                        d ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 focus:border-indigo-400'
                      }`} />
                  ))}
                </div>
                {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
                <button type="submit" disabled={loading || otp.join('').length !== 6}
                  className="mt-5 w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-semibold py-3 rounded-xl transition-colors flex items-center justify-center gap-2">
                  {loading ? <><Spinner />Verifying...</> : 'Verify & Sign In'}
                </button>
                <p className="mt-4 text-center text-sm text-gray-400">
                  {resendTimer > 0
                    ? <>Resend in <span className="text-indigo-600 font-semibold">{resendTimer}s</span></>
                    : <button type="button" onClick={sendOTP} className="text-indigo-600 font-medium hover:underline">Resend OTP</button>
                  }
                </p>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Spinner() {
  return (
    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}
