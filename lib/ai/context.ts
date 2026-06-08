import { createClient } from '@/lib/supabase/server'
import { generateQueryEmbedding } from './embedding'

export async function retrieveRelevantContext(
  userId: string,
  currentMessage: string,
  limit = 3
): Promise<string> {
  // 没有配置 Jina Key 时静默跳过，不影响对话
  if (!process.env.JINA_API_KEY) return ''

  try {
    const supabase = await createClient()
    const embedding = await generateQueryEmbedding(currentMessage)

    const { data } = await supabase.rpc('match_summaries', {
      query_embedding: embedding,
      match_user_id: userId,
      match_count: limit,
    })

    if (!data || data.length === 0) return ''

    const snippets = (data as Array<{ summary: string; created_at: string }>).map(row => {
      const date = new Date(row.created_at).toLocaleDateString('zh-CN')
      return `[${date}] ${row.summary}`
    })

    return `相关历史片段：\n${snippets.join('\n')}`
  } catch {
    return ''
  }
}
