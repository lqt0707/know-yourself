import { create } from 'zustand'
import type { Message, ChatSession } from '@/types'

interface ChatState {
  sessions: ChatSession[]
  currentSessionId: string | null
  messages: Message[]
  isStreaming: boolean
  streamingContent: string
  setSessions: (sessions: ChatSession[]) => void
  setCurrentSession: (sessionId: string) => void
  setMessages: (messages: Message[]) => void
  addMessage: (message: Message) => void
  setStreaming: (streaming: boolean) => void
  appendStreamingContent: (text: string) => void
  clearStreamingContent: () => void
}

export const useChatStore = create<ChatState>((set) => ({
  sessions: [],
  currentSessionId: null,
  messages: [],
  isStreaming: false,
  streamingContent: '',
  setSessions: (sessions) => set({ sessions }),
  setCurrentSession: (sessionId) => set({ currentSessionId: sessionId }),
  setMessages: (messages) => set({ messages }),
  addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
  setStreaming: (streaming) => set({ isStreaming: streaming }),
  appendStreamingContent: (text) => set((state) => ({ streamingContent: state.streamingContent + text })),
  clearStreamingContent: () => set({ streamingContent: '' }),
}))
