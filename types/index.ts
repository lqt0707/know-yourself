export type MessageRole = 'user' | 'assistant'

export interface Message {
  id: string
  session_id: string
  user_id: string
  role: MessageRole
  content: string
  created_at: string
}

export interface ChatSession {
  id: string
  user_id: string
  title: string | null
  created_at: string
  last_message_at: string
}

export type ModelTier = 'flash' | 'pro'

export interface AIMessage {
  role: MessageRole
  content: string
}
