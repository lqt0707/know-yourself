'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ChatWindow } from '@/components/chat/ChatWindow'
import { ChatInput } from '@/components/chat/ChatInput'
import { useChatStore } from '@/lib/stores/chat'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import type { Message, ChatSession } from '@/types'

export default function ChatPage() {
  const { sessions, currentSessionId, setSessions, setCurrentSession, setMessages } = useChatStore()

  useEffect(() => { loadSessions() }, [])

  async function loadSessions() {
    const supabase = createClient()
    const { data } = await supabase.from('chat_sessions').select('*')
      .order('last_message_at', { ascending: false })
    if (data) {
      setSessions(data as ChatSession[])
      if (data.length > 0 && !currentSessionId) selectSession(data[0].id)
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
    const supabase = createClient()
    const { data } = await supabase.from('chat_sessions')
      .insert({ title: '新对话' }).select().single()
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

  return (
    <>
      <aside className="w-64 border-r flex flex-col">
        <div className="p-4"><h1 className="font-semibold text-lg">知己</h1></div>
        <Separator />
        <div className="p-2">
          <Button variant="outline" className="w-full" onClick={newSession}>+ 新对话</Button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {sessions.map((s) => (
            <button key={s.id} onClick={() => selectSession(s.id)}
              className={`w-full text-left px-3 py-2 rounded-md text-sm truncate transition-colors ${
                s.id === currentSessionId ? 'bg-accent' : 'hover:bg-muted'}`}>
              {s.title ?? '对话'}
            </button>
          ))}
        </div>
        <Separator />
        <div className="p-2">
          <Button variant="ghost" className="w-full text-muted-foreground" onClick={handleSignOut}>
            退出登录
          </Button>
        </div>
      </aside>
      <main className="flex-1 flex flex-col">
        {currentSessionId ? (
          <><ChatWindow /><ChatInput /></>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <p className="text-lg">开始一段新对话</p>
              <Button className="mt-4" onClick={newSession}>新建对话</Button>
            </div>
          </div>
        )}
      </main>
    </>
  )
}
