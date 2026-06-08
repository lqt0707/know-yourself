import { createChatCompletion } from './client'
import type { AIMessage } from '@/types'

export interface SessionSummary {
  summary: string
  key_emotions: string[]
  key_topics: string[]
  key_people: string[]
}

const SUMMARIZE_PROMPT = `你是一个分析助手。给定一段对话记录，提取以下内容并以 JSON 返回：

{
  "summary": "三句话内概括本次对话的核心内容和情感基调",
  "key_emotions": ["情绪1", "情绪2"],
  "key_topics": ["话题1", "话题2"],
  "key_people": ["涉及的具体人物姓名或关系，如：小明、妈妈。没有则返回空数组"]
}

只返回 JSON，不要其他内容。`

export async function summarizeSession(messages: AIMessage[]): Promise<SessionSummary> {
  const transcript = messages
    .map(m => `${m.role === 'user' ? '用户' : 'AI'}：${m.content}`)
    .join('\n')

  const completion = await createChatCompletion({
    messages: [{ role: 'user', content: `对话记录：\n\n${transcript}` }],
    tier: 'flash',
    systemPrompt: SUMMARIZE_PROMPT,
  }) as { choices: Array<{ message: { content: string } }> }

  const raw = completion.choices[0].message.content.trim()
  const jsonStr = raw.replace(/^```json\s*/m, '').replace(/\s*```$/m, '')
  return JSON.parse(jsonStr) as SessionSummary
}
