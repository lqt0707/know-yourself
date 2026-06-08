import { createClient } from '@/lib/supabase/server'
import { classifyMessage } from '@/lib/ai/router'
import { buildSystemPrompt, formatProfileForPrompt } from '@/lib/ai/prompts'
import { createChatCompletion } from '@/lib/ai/client'
import { retrieveRelevantContext } from '@/lib/ai/context'
import { generateInsightReport } from '@/lib/ai/insights'
import { EMPTY_PROFILE } from '@/lib/ai/profile'
import type { AIMessage, UserProfile, ProfilePattern } from '@/types'

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

// 识别用户对确认问句的回答，更新 pattern.confirmed_by_user
async function resolveConfirmation(
  supabase: SupabaseClient,
  userId: string,
  userMessage: string,
  patternDescription: string,
) {
  const CLASSIFY_PROMPT = `判断用户的消息是否在回应一个关于其行为模式的确认问句。
模式描述：${patternDescription}
用户消息：${userMessage}
只返回 JSON：{"result": "confirmed" | "denied" | "neutral"}`

  try {
    const completion = await createChatCompletion({
      messages: [{ role: 'user', content: userMessage }],
      tier: 'flash',
      systemPrompt: CLASSIFY_PROMPT,
    }) as { choices: Array<{ message: { content: string } }> }

    const raw = completion.choices[0].message.content.trim()
    const jsonStr = raw.replace(/^```json\s*/m, '').replace(/\s*```$/m, '')
    const { result } = JSON.parse(jsonStr) as { result: 'confirmed' | 'denied' | 'neutral' }
    if (result === 'neutral') return

    const { data: row } = await supabase.from('profiles').select('profile_data').eq('id', userId).single()
    const profile = (row?.profile_data as UserProfile | null) ?? EMPTY_PROFILE
    const patterns = (profile.patterns ?? []).map(p => {
      if (p.description === patternDescription) {
        return { ...p, confirmed_by_user: result === 'confirmed' }
      }
      return p
    })
    await supabase.from('profiles')
      .update({ profile_data: { ...profile, patterns } })
      .eq('id', userId)
  } catch {
    // 静默失败
  }
}

// 把洞察报告里的 new_patterns merge 进用户画像（不重复添加）
async function mergeNewPatternsToProfile(
  supabase: SupabaseClient,
  userId: string,
  newPatterns: Array<{ type: string; description: string }>,
) {
  if (!newPatterns.length) return
  const { data: row } = await supabase.from('profiles').select('profile_data').eq('id', userId).single()
  const profile = (row?.profile_data as UserProfile | null) ?? EMPTY_PROFILE
  const today = new Date().toISOString()

  const existing = profile.patterns ?? []
  const merged = [...existing]
  for (const p of newPatterns) {
    const dup = merged.find(e => e.description === p.description)
    if (dup) {
      dup.evidence_count += 1
      dup.last_seen = today
    } else {
      const entry: ProfilePattern = {
        description: p.description,
        evidence_count: 1,
        first_seen: today,
        last_seen: today,
        confirmed_by_user: null,
      }
      merged.push(entry)
    }
  }
  await supabase.from('profiles')
    .update({ profile_data: { ...profile, patterns: merged } })
    .eq('id', userId)
}

async function annotateEmotion(supabase: SupabaseClient, messageId: string, content: string) {
  const EMOTION_PROMPT = `分析这条消息的情绪。只返回 JSON，不要其他内容：
{"emotion": "情绪名称（如：焦虑、平静、开心、孤独、愤怒、兴奋）", "intensity": 0.0到1.0之间的数字, "trigger": "触发原因，10字内，没有则返回null"}`

  try {
    const completion = await createChatCompletion({
      messages: [{ role: 'user', content }],
      tier: 'flash',
      systemPrompt: EMOTION_PROMPT,
    }) as { choices: Array<{ message: { content: string } }> }

    const raw = completion.choices[0].message.content.trim()
    const jsonStr = raw.replace(/^```json\s*/m, '').replace(/\s*```$/m, '')
    const { emotion, intensity, trigger } = JSON.parse(jsonStr)

    await supabase.from('messages').update({
      emotion_label: emotion,
      emotion_intensity: intensity,
      emotion_trigger: trigger ?? null,
    }).eq('id', messageId)
  } catch {
    // 静默失败，不影响对话
  }
}

async function maybeRunAnalysis(supabase: SupabaseClient, userId: string) {
  const { count } = await supabase
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('role', 'assistant')

  if (!count || count % 5 !== 0) return

  const { data: summaries } = await supabase
    .from('session_summaries')
    .select('summary, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(20)

  if (!summaries || summaries.length < 3) return

  const { data: profileRow } = await supabase
    .from('profiles').select('profile_data').eq('id', userId).single()

  const profile = (profileRow?.profile_data as UserProfile | null) ?? EMPTY_PROFILE
  const report = await generateInsightReport(summaries, profile)

  await supabase.from('insight_reports').insert({
    user_id: userId,
    period_start: summaries[summaries.length - 1].created_at,
    period_end: summaries[0].created_at,
    content: report.content,
    new_patterns: report.new_patterns,
    trends: report.trends,
    pending_confirmations: report.pending_confirmations,
  })

  // new_patterns 回写画像
  await mergeNewPatternsToProfile(supabase, userId, report.new_patterns)

  await supabase.from('profiles')
    .update({ last_analyzed_at: new Date().toISOString() })
    .eq('id', userId)
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const { message, sessionId, history } = await request.json() as {
    message: string; sessionId: string; history: AIMessage[]
  }

  const { data: session } = await supabase
    .from('chat_sessions').select('id')
    .eq('id', sessionId).eq('user_id', user.id).single()
  if (!session) return new Response('Session not found', { status: 404 })

  // 写入用户消息，拿到 id 用于情绪标注
  const { data: userMsg } = await supabase.from('messages').insert({
    session_id: sessionId, user_id: user.id, role: 'user', content: message,
  }).select('id').single()

  // 异步情绪标注，不阻塞流式输出
  if (userMsg) annotateEmotion(supabase, userMsg.id, message).catch(() => {})

  // 并行：场景分类 + 加载画像 + 语义检索 + 检查待确认项
  const [{ scene, tier }, profileRow, relevantContext, latestReport] = await Promise.all([
    classifyMessage(message),
    supabase.from('profiles').select('profile_data').eq('id', user.id).single()
      .then(r => r.data),
    retrieveRelevantContext(user.id, message),
    supabase.from('insight_reports')
      .select('id, pending_confirmations, last_asked_confirmation')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
      .then(r => r.data),
  ])

  // 若有未处理的确认问句，异步识别用户回答并更新画像
  const lastAsked = latestReport?.last_asked_confirmation as
    { question: string; pattern_description: string } | null
  if (lastAsked) {
    resolveConfirmation(supabase, user.id, message, lastAsked.pattern_description).catch(() => {})
    // 清除已处理的确认记录
    supabase.from('insight_reports')
      .update({ last_asked_confirmation: null })
      .eq('id', latestReport!.id)
      .then(() => {})
  }

  const profileSummary = formatProfileForPrompt(
    (profileRow?.profile_data as Record<string, unknown>) ?? {}
  )
  const systemPrompt = buildSystemPrompt(scene, profileSummary || undefined, relevantContext || undefined)
  const messages: AIMessage[] = [...history.slice(-10), { role: 'user', content: message }]

  // 检查是否需要在本轮注入确认问句
  const pending = latestReport?.pending_confirmations as
    Array<{ question: string; pattern_description: string }> | null
  const hasPending = pending && pending.length > 0

  const stream = await createChatCompletion({ messages, tier, systemPrompt, stream: true }) as
    AsyncIterable<{ choices: Array<{ delta: { content?: string }; finish_reason: string | null }> }>

  let fullContent = ''
  const readable = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      try {
        for await (const chunk of stream) {
          const text = chunk.choices[0]?.delta?.content ?? ''
          if (text) {
            fullContent += text
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`))
          }
          if (chunk.choices[0]?.finish_reason === 'stop') {
            // 若有待确认项，自然追加到回复末尾
            if (hasPending) {
              const confirmText = `\n\n---\n\n${pending![0].question}`
              fullContent += confirmText
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: confirmText })}\n\n`))

              // 清空 pending，记录本次已问的项，供下轮识别用户回答
              await supabase.from('insight_reports')
                .update({
                  pending_confirmations: [],
                  last_asked_confirmation: pending![0],
                })
                .eq('id', latestReport!.id)
            }

            await supabase.from('messages').insert({
              session_id: sessionId, user_id: user.id, role: 'assistant', content: fullContent,
            })
            await supabase.from('chat_sessions')
              .update({ last_message_at: new Date().toISOString() }).eq('id', sessionId)

            // 异步触发分析（每 5 条 assistant 消息）
            maybeRunAnalysis(supabase, user.id).catch(() => {})

            controller.enqueue(encoder.encode(`data: [DONE]\n\n`))
            controller.close()
          }
        }
      } catch (err) { controller.error(err) }
    },
  })

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
