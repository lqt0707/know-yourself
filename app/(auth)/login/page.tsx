'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    router.push('/chat')
    router.refresh()
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-wordmark" style={{ textAlign: 'center', marginBottom: '0.5rem' }}>
          <h1>知己</h1>
          <p className="subtitle">你的 AI 自我认知伴侣</p>
        </div>

        <hr style={{
          margin: '1.75rem 0',
          border: 'none',
          borderTop: '1px solid var(--warm-border)',
          opacity: 0.6,
        }} />

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '1.1rem' }}>
            <label style={{
              display: 'block',
              fontFamily: "'Lora', serif",
              fontSize: '0.78rem',
              fontWeight: 500,
              color: 'var(--warm-text-muted)',
              letterSpacing: '0.05em',
              marginBottom: '0.45rem',
            }}>
              电子邮箱
            </label>
            <input
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="warm-input"
            />
          </div>

          <div style={{ marginBottom: '1.1rem' }}>
            <label style={{
              display: 'block',
              fontFamily: "'Lora', serif",
              fontSize: '0.78rem',
              fontWeight: 500,
              color: 'var(--warm-text-muted)',
              letterSpacing: '0.05em',
              marginBottom: '0.45rem',
            }}>
              密码
            </label>
            <input
              type="password"
              placeholder="请输入密码…"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="warm-input"
            />
          </div>

          {error && (
            <p style={{
              fontSize: '0.82rem',
              color: '#B45242',
              marginBottom: '0.75rem',
              fontFamily: "'Lora', serif",
              fontStyle: 'italic',
            }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn-warm-primary"
            style={{ marginTop: '0.5rem' }}
          >
            {loading ? '登录中…' : '登录'}
          </button>
        </form>

        <p style={{
          textAlign: 'center',
          marginTop: '1.5rem',
          fontFamily: "'Lora', serif",
          fontSize: '0.82rem',
          color: 'var(--warm-text-muted)',
        }}>
          没有账号？{' '}
          <Link
            href="/register"
            style={{
              color: 'var(--warm-accent)',
              textDecoration: 'none',
              fontStyle: 'italic',
            }}
          >
            注册
          </Link>
        </p>
      </div>
    </div>
  )
}
