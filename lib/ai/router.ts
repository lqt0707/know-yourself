import type { ModelTier, AIMessage } from '@/types'
import { createChatCompletion } from './client'
import { CLASSIFY_SCENE_PROMPT } from './prompts'

export type Scene = 'emotional' | 'exploration' | 'analytical' | 'casual'

export async function classifyMessage(userMessage: string): Promise<{ scene: Scene; tier: ModelTier }> {
  const completion = await createChatCompletion({
    messages: [{ role: 'user', content: userMessage }],
    tier: 'flash',
    systemPrompt: CLASSIFY_SCENE_PROMPT,
  }) as { choices: Array<{ message: { content: string } }> }

  const raw = completion.choices[0].message.content.trim().toLowerCase()
  const scene = (['emotional', 'exploration', 'analytical', 'casual'] as Scene[])
    .find(s => raw.includes(s)) ?? 'casual'
  const tier: ModelTier = scene === 'casual' ? 'flash' : 'pro'
  return { scene, tier }
}
