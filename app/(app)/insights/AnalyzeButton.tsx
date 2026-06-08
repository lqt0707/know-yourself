'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function AnalyzeButton() {
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')
  const router = useRouter()

  async function handleAnalyze() {
    setLoading(true)
    setMsg('')
    try {
      const res = await fetch('/api/analyze', { method: 'POST' })
      const data = await res.json() as { ok?: boolean; skipped?: boolean; reason?: string }
      if (data.skipped) {
        setMsg('对话记录还不够，多聊几次再来看看。')
      } else if (data.ok) {
        setMsg('分析完成！')
        router.refresh()
      } else {
        setMsg('分析失败，稍后再试。')
      }
    } catch {
      setMsg('网络错误，稍后再试。')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
      <button
        onClick={handleAnalyze}
        disabled={loading}
        style={{
          padding: '0.45rem 1.2rem',
          borderRadius: '20px',
          border: '1px solid rgba(120, 70, 30, 0.25)',
          background: loading ? 'rgba(192, 120, 80, 0.08)' : 'transparent',
          color: 'var(--warm-accent)',
          fontFamily: "'Lora', serif",
          fontSize: '0.8rem',
          cursor: loading ? 'not-allowed' : 'pointer',
          transition: 'all 0.15s',
          opacity: loading ? 0.6 : 1,
        }}
      >
        {loading ? '分析中…' : '立即分析'}
      </button>
      {msg && (
        <span style={{
          fontFamily: "'Lora', serif",
          fontSize: '0.78rem',
          fontStyle: 'italic',
          color: 'var(--warm-text-muted)',
        }}>
          {msg}
        </span>
      )}
    </div>
  )
}
