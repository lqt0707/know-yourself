'use client'

import { Suspense, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { ChatWindow } from '@/components/chat/ChatWindow'
import { ChatInput } from '@/components/chat/ChatInput'
import { useChatStore } from '@/lib/stores/chat'
import type { Message, ChatSession } from '@/types'

function formatSessionDate(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (diffDays === 0) return '今天'
  if (diffDays === 1) return '昨天'
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

function ChatPageInner() {
  const { sessions, currentSessionId, setSessions, setCurrentSession, setMessages } = useChatStore()
  const searchParams = useSearchParams()

  useEffect(() => { loadSessions() }, [])

  async function loadSessions() {
    const supabase = createClient()
    const { data } = await supabase.from('chat_sessions').select('*')
      .order('last_message_at', { ascending: false })
    if (data) {
      setSessions(data as ChatSession[])
      const targetSession = searchParams.get('session')
      if (targetSession && data.some(s => s.id === targetSession)) {
        selectSession(targetSession)
      } else if (data.length > 0 && !currentSessionId) {
        selectSession(data[0].id)
      }
    }
  }

  async function selectSession(sessionId: string) {
    setCurrentSession(sessionId)
    const supabase = createClient()
    const { data } = await supabase.from('messages').select('*')
      .eq('session_id', sessionId).order('created_at', { ascending: true })
    if (data) setMessages(data as Message[])
  }

  async function newSession() {
    if (currentSessionId) {
      fetch('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: currentSessionId }),
      }).catch(() => {})
    }

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data } = await supabase.from('chat_sessions')
      .insert({ title: '新对话', user_id: user.id }).select().single()
    if (data) {
      setSessions([data as ChatSession, ...sessions])
      selectSession(data.id)
    }
  }

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  const currentSession = sessions.find(s => s.id === currentSessionId)

  return (
    <>
      <aside className="sidebar">
        <div className="sidebar-wordmark" style={{
          paddingBottom: '0.75rem',
          borderBottom: '1px solid rgba(120, 70, 30, 0.12)',
        }}>
          <h2>知己</h2>
          <p className="tagline">认识自己，遇见自己</p>
        </div>

        <button className="btn-new-chat" onClick={newSession}>
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="6.5" y1="1" x2="6.5" y2="12" />
            <line x1="1" y1="6.5" x2="12" y2="6.5" />
          </svg>
          新对话
        </button>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.35rem', overflowY: 'auto' }}>
          {sessions.length > 0 && (
            <div style={{
              fontFamily: "'Lora', serif",
              fontSize: '0.68rem',
              fontWeight: 500,
              letterSpacing: '0.08em',
              color: 'var(--warm-text-muted)',
              textTransform: 'uppercase',
              padding: '0 0.5rem',
              marginBottom: '0.2rem',
            }}>
              最近的对话
            </div>
          )}
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`session-item${s.id === currentSessionId ? ' active' : ''}`}
              onClick={() => selectSession(s.id)}
            >
              <div className="session-title">{s.title ?? '对话'}</div>
              <div className="session-date">{formatSessionDate(s.last_message_at)}</div>
            </div>
          ))}
          {sessions.length === 0 && (
            <p style={{
              fontFamily: "'Lora', serif",
              fontSize: '0.78rem',
              fontStyle: 'italic',
              color: 'var(--warm-text-muted)',
              padding: '0.5rem',
              opacity: 0.7,
            }}>
              还没有对话，点击上方开始吧
            </p>
          )}
        </div>

        <div style={{ borderTop: '1px solid rgba(120, 70, 30, 0.1)', paddingTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          {[
            { href: '/insights', label: '◆ 洞察报告' },
            { href: '/dashboard', label: '◇ 情绪仪表盘' },
          ].map(({ href, label }) => (
            <Link key={href} href={href} style={{
              display: 'block',
              padding: '0.45rem 0.75rem',
              borderRadius: '6px',
              fontFamily: "'Lora', serif",
              fontSize: '0.8rem',
              color: 'var(--warm-text-muted)',
              textDecoration: 'none',
            }}>
              {label}
            </Link>
          ))}
          <button className="btn-logout" onClick={handleSignOut}>
            ↩ 退出登录
          </button>
        </div>
      </aside>

      <main className="chat-main">
        {currentSession ? (
          <>
            <header className="chat-header">
              <div>
                <div className="chat-header-title">{currentSession.title ?? '对话'}</div>
                <div className="chat-header-meta">
                  {formatSessionDate(currentSession.last_message_at)}
                </div>
              </div>
            </header>
            <ChatWindow />
            <ChatInput />
          </>
        ) : (
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '1.5rem',
          }}>
            <div style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #5A2E10 0%, #9A5430 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 20px rgba(80, 24, 6, 0.30)',
            }}>
              <span style={{
                fontFamily: "'Noto Serif SC', serif",
                fontSize: '1.6rem',
                fontWeight: 700,
                color: '#FDF6EE',
              }}>知</span>
            </div>
            <div style={{ textAlign: 'center' }}>
              <p style={{
                fontFamily: "'Noto Serif SC', serif",
                fontSize: '1.1rem',
                fontWeight: 500,
                color: 'var(--warm-text)',
                marginBottom: '0.5rem',
              }}>开始一段新对话</p>
              <p style={{
                fontFamily: "'Lora', serif",
                fontSize: '0.85rem',
                fontStyle: 'italic',
                color: 'var(--warm-text-muted)',
              }}>认识自己，从这里开始</p>
            </div>
            <button className="btn-warm-primary" onClick={newSession} style={{ width: 'auto', padding: '0.75rem 2rem' }}>
              新建对话
            </button>
          </div>
        )}
      </main>
    </>
  )
}

export default function ChatPage() {
  return (
    <Suspense>
      <ChatPageInner />
    </Suspense>
  )
}
