import OpenAI from 'openai'
import type { ModelTier, AIMessage } from '@/types'

const deepseek = new OpenAI({
  baseURL: 'https://api.deepseek.com',
  apiKey: process.env.DEEPSEEK_API_KEY!,
})

const MODEL_MAP: Record<ModelTier, string> = {
  flash: 'deepseek-chat',
  pro: 'deepseek-reasoner',
}

export interface ChatCompletionOptions {
  messages: AIMessage[]
  tier: ModelTier
  systemPrompt: string
  stream?: boolean
}

export async function createChatCompletion(options: ChatCompletionOptions) {
  const { messages, tier, systemPrompt, stream = false } = options
  return deepseek.chat.completions.create({
    model: MODEL_MAP[tier],
    messages: [{ role: 'system', content: systemPrompt }, ...messages],
    stream,
    max_tokens: tier === 'pro' ? 4096 : 2048,
  })
}
