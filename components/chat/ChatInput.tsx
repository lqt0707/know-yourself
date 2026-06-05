'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useChatStore } from '@/lib/stores/chat'
import { createClient } from '@/lib/supabase/client'
import type { AIMessage, Message } from '@/types'

export function ChatInput() {
  const [input, setInput] = useState('')
  const { currentSessionId, messages, isStreaming, setStreaming,
    appendStreamingContent, clearStreamingContent, setMessages } = useChatStore()

  async function handleSend() {
    const text = input.trim()
    if (!text || !currentSessionId || isStreaming) return
    setInput('')
    setStreaming(true)
    clearStreamingContent()

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
          const { text: chunk } = JSON.parse(payload)
          appendStreamingContent(chunk)
        }
      }
    } catch (err) {
      console.error(err)
    } finally {
      setStreaming(false)
      clearStreamingContent()
    }
  }

  return (
    <div className="border-t p-4">
      <div className="flex gap-2 items-end">
        <Textarea
          placeholder="说点什么..."
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
          rows={1}
          className="resize-none min-h-[44px] max-h-[200px]"
          disabled={isStreaming}
        />
        <Button onClick={handleSend} disabled={!input.trim() || isStreaming || !currentSessionId}>
          发送
        </Button>
      </div>
      <p className="text-xs text-muted-foreground mt-1">Enter 发送，Shift+Enter 换行</p>
    </div>
  )
}
