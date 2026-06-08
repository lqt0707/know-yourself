'use client'

import { useState, useRef, useEffect } from 'react'
import { useChatStore } from '@/lib/stores/chat'
import { createClient } from '@/lib/supabase/client'
import type { AIMessage, Message } from '@/types'

export function ChatInput() {
  const [input, setInput] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const {
    currentSessionId, messages, isStreaming,
    setStreaming, appendStreamingContent, clearStreamingContent, setMessages, addMessage,
  } = useChatStore()

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 128) + 'px'
  }, [input])

  async function handleSend() {
    const text = input.trim()
    if (!text || !currentSessionId || isStreaming) return
    setInput('')
    setStreaming(true)
    clearStreamingContent()

    // 乐观更新：立即显示用户消息，不等网络
    const optimisticMsg: Message = {
      id: `optimistic-${Date.now()}`,
      session_id: currentSessionId,
      user_id: '',
      role: 'user',
      content: text,
      created_at: new Date().toISOString(),
    }
    addMessage(optimisticMsg)

    const history: AIMessage[] = messages.slice(-10).map(m => ({ role: m.role, content: m.content }))

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, sessionId: currentSessionId, history }),
      })
      if (!res.ok) throw new Error('Chat request failed')

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        for (const line of decoder.decode(value).split('\n')) {
          if (!line.startsWith('data: ')) continue
          const payload = line.slice(6)
          if (payload === '[DONE]') {
            const supabase = createClient()
            const { data } = await supabase.from('messages').select('*')
              .eq('session_id', currentSessionId).order('created_at', { ascending: true })
            if (data) setMessages(data as Message[])
            break
          }
          try {
            const { text: chunk } = JSON.parse(payload)
            appendStreamingContent(chunk)
          } catch { /* ignore malformed */ }
        }
      }
    } catch (err) {
      console.error(err)
    } finally {
      setStreaming(false)
      clearStreamingContent()
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="chat-input-area">
      <div className="input-wrapper">
        <textarea
          ref={textareaRef}
          className="chat-textarea"
          placeholder="在这里写下你的想法…"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={isStreaming || !currentSessionId}
        />
        <button
          className="btn-send"
          onClick={handleSend}
          disabled={!input.trim() || isStreaming || !currentSessionId}
          aria-label="发送"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="#FDF6EE">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
          </svg>
        </button>
      </div>
      <p style={{
        fontFamily: "'Lora', serif",
        fontSize: '0.68rem',
        fontStyle: 'italic',
        color: 'var(--warm-text-muted)',
        opacity: 0.7,
        textAlign: 'center',
        marginTop: '0.5rem',
      }}>
        按 Enter 发送，Shift+Enter 换行
      </p>
    </div>
  )
}
