import { createClient } from '@/lib/supabase/server'
import { summarizeSession } from '@/lib/ai/memory'
import { generateEmbedding } from '@/lib/ai/embedding'
import { updateUserProfile, EMPTY_PROFILE } from '@/lib/ai/profile'
import type { AIMessage, UserProfile } from '@/types'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const { sessionId } = await request.json() as { sessionId: string }

  // 检查是否已有摘要，避免重复处理
  const { data: existing } = await supabase
    .from('session_summaries')
    .select('id')
    .eq('session_id', sessionId)
    .single()

  if (existing) return Response.json({ skipped: true })

  // 加载该 session 全部消息
  const { data: messages } = await supabase
    .from('messages')
    .select('role, content')
    .eq('session_id', sessionId)
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })

  if (!messages || messages.length < 2) {
    return Response.json({ skipped: true })
  }

  // 生成摘要
  const summary = await summarizeSession(messages as AIMessage[])

  // 生成 embedding（无 Jina Key 时跳过向量，摘要仍写入）
  let embedding: number[] | null = null
  if (process.env.JINA_API_KEY) {
    embedding = await generateEmbedding(summary.summary)
  }

  await supabase.from('session_summaries').insert({
    session_id: sessionId,
    user_id: user.id,
    summary: summary.summary,
    embedding,
    key_emotions: summary.key_emotions,
    key_topics: summary.key_topics,
    key_people: summary.key_people,
  })

  // 更新用户画像
  const { data: profileRow } = await supabase
    .from('profiles')
    .select('profile_data')
    .eq('id', user.id)
    .single()

  const currentProfile = (profileRow?.profile_data as UserProfile | null) ?? EMPTY_PROFILE
  const updatedProfile = await updateUserProfile(
    currentProfile,
    summary,
    new Date().toISOString().split('T')[0]
  )

  await supabase
    .from('profiles')
    .update({ profile_data: updatedProfile })
    .eq('id', user.id)

  return Response.json({ ok: true })
}
