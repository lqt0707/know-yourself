export type MessageRole = 'user' | 'assistant'

export interface Message {
  id: string
  session_id: string
  user_id: string
  role: MessageRole
  content: string
  created_at: string
  emotion_label?: string | null
  emotion_intensity?: number | null
  emotion_trigger?: string | null
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

export interface ProfilePattern {
  description: string
  evidence_count: number
  first_seen: string
  last_seen: string
  confirmed_by_user: boolean | null
}

export interface UserProfile {
  personality: {
    traits: string[]
    values: string[]
    confidence: number
  }
  patterns: ProfilePattern[]
  relationships: Array<{ name: string; role: string; dynamic: string }>
  emotional_baseline: {
    dominant: string
    triggers: string[]
  }
  life_themes: Array<{ theme: string; status: string }>
}
