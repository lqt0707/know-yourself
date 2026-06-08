import { createChatCompletion } from './client'
import type { UserProfile } from '@/types'
import type { SessionSummary } from './memory'

export const EMPTY_PROFILE: UserProfile = {
  personality: { traits: [], values: [], confidence: 0 },
  patterns: [],
  relationships: [],
  emotional_baseline: { dominant: '未知', triggers: [] },
  life_themes: [],
}

const UPDATE_PROFILE_PROMPT = `你是一个用户画像分析师。根据新的对话摘要，更新用户画像 JSON。

规则：
1. 发现新的行为模式时，检查是否与已有 patterns 相似，若是则增加 evidence_count，更新 last_seen
2. 全新的模式从 evidence_count=1、confirmed_by_user=null 开始
3. 不要删除已有数据，只增量更新
4. 更新 emotional_baseline 时参考新摘要的情绪数据
5. 只返回更新后的完整 JSON，不要其他内容`

export async function updateUserProfile(
  currentProfile: UserProfile,
  summary: SessionSummary,
  today: string
): Promise<UserProfile> {
  const prompt = `当前画像：
${JSON.stringify(currentProfile, null, 2)}

新对话摘要：
${summary.summary}

情绪：${summary.key_emotions.join('、') || '无'}
话题：${summary.key_topics.join('、') || '无'}
涉及人物：${summary.key_people.join('、') || '无'}
日期：${today}`

  const completion = await createChatCompletion({
    messages: [{ role: 'user', content: prompt }],
    tier: 'flash',
    systemPrompt: UPDATE_PROFILE_PROMPT,
  }) as { choices: Array<{ message: { content: string } }> }

  const raw = completion.choices[0].message.content.trim()
  const jsonStr = raw.replace(/^```json\s*/m, '').replace(/\s*```$/m, '')
  return JSON.parse(jsonStr) as UserProfile
}
