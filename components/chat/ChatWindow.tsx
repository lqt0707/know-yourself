'use client'

import { useEffect, useRef } from 'react'
import { MessageBubble } from './MessageBubble'
import { useChatStore } from '@/lib/stores/chat'

function formatTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

export function ChatWindow() {
  const { messages, isStreaming, streamingContent } = useChatStore()
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  return (
    <div
      style={{
        flex: 1,
        overflowY: 'auto',
        padding: '2rem 1.75rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1.5rem',
        scrollBehavior: 'smooth',
      }}
    >
      {messages.length === 0 && !isStreaming && (
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '1rem',
          paddingTop: '3.5rem',
        }}>
          <div
            className="empty-avatar-pulse"
            style={{
              width: 60,
              height: 60,
              borderRadius: '50%',
              background: 'linear-gradient(145deg, #864220 0%, #9A5430 50%, #A86040 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span style={{
              fontFamily: "'Noto Serif SC', serif",
              fontSize: '1.5rem',
              fontWeight: 700,
              color: '#FDF8F2',
            }}>知</span>
          </div>
          <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <p style={{
              fontFamily: "'Noto Serif SC', serif",
              fontSize: '0.95rem',
              fontWeight: 500,
              color: 'var(--warm-text)',
              opacity: 0.85,
            }}>
              今天，有什么想说的吗？
            </p>
            <p style={{
              fontFamily: "'Lora', serif",
              fontSize: '0.8rem',
              fontStyle: 'italic',
              color: 'var(--warm-text-muted)',
              lineHeight: 1.7,
              opacity: 0.75,
            }}>
              我在这里，陪伴你。
            </p>
          </div>
        </div>
      )}

      {messages.map((msg) => (
        <MessageBubble
          key={msg.id}
          role={msg.role}
          content={msg.content}
          timestamp={formatTime(msg.created_at)}
          emotion_label={msg.emotion_label}
          emotion_intensity={msg.emotion_intensity}
        />
      ))}

      {isStreaming && (
        <MessageBubble
          role="assistant"
          content={streamingContent}
          isStreaming
        />
      )}

      <div ref={bottomRef} />
    </div>
  )
}
