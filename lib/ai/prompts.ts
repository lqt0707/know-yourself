export const CLASSIFY_SCENE_PROMPT = `Classify the user message into one scene. Reply with ONLY the scene name.

Scenes:
- emotional: venting, sad, anxious, strong feelings
- exploration: reflecting on life direction, meaning, identity, values
- analytical: analyzing a specific problem or decision
- casual: light chat, small talk

Reply with exactly one word.`

export const BASE_PERSONA = `你是用户的私人 AI 伴侣，专注于帮助他们深入了解自己。你的名字叫"知己"。

核心原则：
- 帮助用户发现他们自己还没意识到的模式、矛盾和盲点
- 记住用户说过的一切，在合适时机关联前后
- 不评判，但直接诚实——不为了让用户舒服而回避真实`

export const SCENE_STYLE: Record<string, string> = {
  emotional: `当前风格：温暖共情。先完全接纳用户的情绪，不急于给建议。`,
  exploration: `当前风格：苏格拉底式。用问题引导用户自己思考，一次只问一个问题。`,
  analytical: `当前风格：直接犀利。指出盲点，不绕弯子，逻辑清晰。`,
  casual: `当前风格：轻松朋友。自然随性，保持温度和趣味。`,
}

export function buildSystemPrompt(
  scene: string,
  profileSummary?: string,
  relevantContext?: string
): string {
  const style = SCENE_STYLE[scene] ?? SCENE_STYLE.casual
  const profile = profileSummary ? `\n\n关于用户的已知信息：\n${profileSummary}` : ''
  const context = relevantContext ? `\n\n${relevantContext}` : ''
  return `${BASE_PERSONA}\n\n${style}${profile}${context}`
}

export function formatProfileForPrompt(profileData: Record<string, unknown>): string {
  if (!profileData || Object.keys(profileData).length === 0) return ''
  const p = profileData as unknown as import('@/types').UserProfile
  const lines: string[] = []
  if (p.personality?.traits?.length)
    lines.push(`性格特征：${p.personality.traits.join('、')}`)
  if (p.emotional_baseline?.dominant && p.emotional_baseline.dominant !== '未知')
    lines.push(`情绪基调：${p.emotional_baseline.dominant}`)
  if (p.emotional_baseline?.triggers?.length)
    lines.push(`情绪触发点：${p.emotional_baseline.triggers.join('、')}`)
  const confirmedPatterns = p.patterns?.filter(x => x.confirmed_by_user) ?? []
  if (confirmedPatterns.length)
    lines.push(`已确认的行为模式：${confirmedPatterns.map(x => x.description).join('；')}`)
  return lines.join('\n')
}
