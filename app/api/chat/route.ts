import { createClient } from '@/lib/supabase/server'
import { classifyMessage } from '@/lib/ai/router'
import { buildSystemPrompt } from '@/lib/ai/prompts'
import { createChatCompletion } from '@/lib/ai/client'
import type { AIMessage } from '@/types'

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

  await supabase.from('messages').insert({
    session_id: sessionId, user_id: user.id, role: 'user', content: message,
  })

  const { scene, tier } = await classifyMessage(message)
  const systemPrompt = buildSystemPrompt(scene)
  const messages: AIMessage[] = [...history.slice(-10), { role: 'user', content: message }]

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
            await supabase.from('messages').insert({
              session_id: sessionId, user_id: user.id, role: 'assistant', content: fullContent,
            })
            await supabase.from('chat_sessions')
              .update({ last_message_at: new Date().toISOString() }).eq('id', sessionId)
            controller.enqueue(encoder.encode(`data: [DONE]\n\n`))
            controller.close()
          }
        }
      } catch (err) { controller.error(err) }
    },
  })

  return new Response(readable, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
  })
}
