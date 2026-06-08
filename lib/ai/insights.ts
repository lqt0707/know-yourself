import { createChatCompletion } from './client'
import type { UserProfile } from '@/types'

export interface InsightReport {
  content: string
  new_patterns: Array<{ type: string; description: string; evidence: string }>
  trends: Array<{ dimension: string; observation: string }>
  pending_confirmations: Array<{ question: string; pattern_description: string }>
}

const INSIGHT_PROMPT = `你是一个深度心理洞察分析师。基于用户的对话摘要历史和当前画像，做多维度分析。

分析维度：
1. 纵向：同一主题跨时间的变化趋势
2. 横向：不同领域间的关联和矛盾
3. 深层：表面行为背后的潜在动机

返回以下 JSON 结构：
{
  "content": "完整的洞察报告正文（200-400字，直接叙述，不用 Markdown 标题）",
  "new_patterns": [
    {"type": "模式/矛盾/变化/盲点", "description": "描述", "evidence": "证据摘要"}
  ],
  "trends": [
    {"dimension": "维度名称", "observation": "观察"}
  ],
  "pending_confirmations": [
    {"question": "自然嵌入对话的确认问句", "pattern_description": "对应的模式描述"}
  ]
}

pending_confirmations 只在发现高置信度但未确认的模式时填写，最多 1 条。
只返回 JSON，不要其他内容。`

export async function generateInsightReport(
  summaries: Array<{ summary: string; created_at: string }>,
  profile: UserProfile
): Promise<InsightReport> {
  const summaryText = summaries
    .map(s => `[${new Date(s.created_at).toLocaleDateString('zh-CN')}] ${s.summary}`)
    .join('\n')

  const prompt = `对话摘要历史（时间倒序）：
${summaryText}

当前用户画像：
${JSON.stringify(profile, null, 2)}`

  const completion = await createChatCompletion({
    messages: [{ role: 'user', content: prompt }],
    tier: 'pro',
    systemPrompt: INSIGHT_PROMPT,
  }) as { choices: Array<{ message: { content: string } }> }

  const raw = completion.choices[0].message.content.trim()
  const jsonStr = raw.replace(/^```json\s*/m, '').replace(/\s*```$/m, '')
  return JSON.parse(jsonStr) as InsightReport
}
