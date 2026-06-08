# Know Yourself Phase 2 — 记忆系统 Implementation Plan

**Goal:** 为对话系统添加持久化记忆能力。每次对话结束后自动提取摘要并向量化存储；发消息时语义召回相关历史 + 用户画像注入上下文，让 AI 真正"认识"用户。

**Architecture:** 新增 session_summaries 表（pgvector）+ profiles.profile_data JSONB。对话结束触发摘要生成流水线：Flash 摘要 → embedding → 写入 DB → 更新画像。发消息时语义检索历史片段，与画像合并注入 system prompt。

---

## File Map（新增/修改）

```
know-yourself/
├── supabase/migrations/
│   └── 002_memory.sql               # 新增：DB schema 扩展
├── lib/ai/
│   ├── embedding.ts                 # 新增：生成文本向量
│   ├── memory.ts                    # 新增：对话摘要提取
│   ├── profile.ts                   # 新增：用户画像自动更新
│   ├── context.ts                   # 新增：语义检索历史片段
│   └── prompts.ts                   # 修改：buildSystemPrompt 增加 context 参数
├── app/api/
│   └── summarize/route.ts           # 新增：摘要触发 API
│   └── chat/route.ts                # 修改：注入画像 + 检索上下文
└── app/(app)/chat/
    └── page.tsx                     # 修改：新建对话时静默触发摘要
```

---

## Task 1：DB Schema 扩展

**Files:**
- Create: `supabase/migrations/002_memory.sql`

### Step 1：写迁移 SQL

Create `supabase/migrations/002_memory.sql`:

```sql
-- 为 profiles 添加画像数据列
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS profile_data JSONB DEFAULT '{}';

-- 对话摘要表（含向量）
-- embedding 维度 1024：使用 Jina AI jina-embeddings-v3（免费，支持中文）
CREATE TABLE public.session_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES public.chat_sessions(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  summary TEXT NOT NULL,
  embedding vector(1024),
  key_emotions TEXT[] DEFAULT '{}',
  key_topics TEXT[] DEFAULT '{}',
  key_people TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.session_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own summaries" ON public.session_summaries
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX session_summaries_user_id_idx ON public.session_summaries(user_id);

-- ivfflat 索引用于语义检索（需要先有数据才能训练，生产环境再建）
-- CREATE INDEX session_summaries_embedding_idx ON public.session_summaries
--   USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

### Step 2：通过 Supabase MCP 应用迁移

使用 `mcp__supabase__apply_migration`，name=`002_memory`，query=上面的 SQL。

Expected：`profiles` 表新增 `profile_data` 列；`session_summaries` 表创建成功，RLS 已开启。

---

## Task 2：Embedding 工具

**Files:**
- Create: `lib/ai/embedding.ts`

### Step 1：写 embedding 工具

使用 **Jina AI**（免费，1M tokens/月，原生支持中文，维度 1024）。API 格式与 OpenAI 兼容，直接用 fetch 调用即可。

Create `lib/ai/embedding.ts`:

```typescript
export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await fetch('https://api.jina.ai/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.JINA_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'jina-embeddings-v3',
      input: [text.slice(0, 8000)],
      task: 'retrieval.passage',
    }),
  })

  if (!response.ok) {
    throw new Error(`Jina embedding failed: ${response.status}`)
  }

  const data = await response.json() as {
    data: Array<{ embedding: number[] }>
  }
  return data.data[0].embedding
}

export async function generateQueryEmbedding(text: string): Promise<number[]> {
  const response = await fetch('https://api.jina.ai/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.JINA_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'jina-embeddings-v3',
      input: [text.slice(0, 2000)],
      task: 'retrieval.query', // 查询时用 query task，效果更好
    }),
  })

  if (!response.ok) {
    throw new Error(`Jina embedding failed: ${response.status}`)
  }

  const data = await response.json() as {
    data: Array<{ embedding: number[] }>
  }
  return data.data[0].embedding
}
```

Note：Jina v3 区分 `retrieval.passage`（存储侧）和 `retrieval.query`（查询侧），分别调用效果比统一用一个 task 好。

### Step 2：更新 .env.local

在 `.env.local` 追加：

```
JINA_API_KEY=your_jina_api_key_here
```

获取方式：注册 https://jina.ai，免费额度 1M tokens，无需信用卡。

### Step 3：更新 context.ts 中的调用

`lib/ai/context.ts` 检索时改用 `generateQueryEmbedding` 而非 `generateEmbedding`：

```typescript
const embedding = await generateQueryEmbedding(currentMessage)
```

---

## Task 3：对话摘要生成

**Files:**
- Create: `lib/ai/memory.ts`

### Step 1：写摘要生成逻辑

Create `lib/ai/memory.ts`:

```typescript
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
  "key_people": ["涉及的具体人物姓名或关系（如：小明、妈妈）"]
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
  const jsonStr = raw.replace(/^```json\s*/, '').replace(/\s*```$/, '')

  return JSON.parse(jsonStr) as SessionSummary
}
```

---

## Task 4：用户画像自动更新

**Files:**
- Create: `lib/ai/profile.ts`
- Modify: `types/index.ts`

### Step 1：扩展 types/index.ts

在 `types/index.ts` 追加：

```typescript
export interface ProfilePattern {
  description: string
  evidence_count: number
  first_seen: string
  last_seen: string
  confirmed_by_user: boolean | null
}

export interface UserProfile {
  personality: {
    traits: string[]
    values: string[]
    confidence: number
  }
  patterns: ProfilePattern[]
  relationships: Array<{ name: string; role: string; dynamic: string }>
  emotional_baseline: {
    dominant: string
    triggers: string[]
  }
  life_themes: Array<{ theme: string; status: string }>
}
```

### Step 2：写画像更新逻辑

Create `lib/ai/profile.ts`:

```typescript
import { createChatCompletion } from './client'
import type { UserProfile } from '@/types'
import type { SessionSummary } from './memory'

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

情绪：${summary.key_emotions.join('、')}
话题：${summary.key_topics.join('、')}
涉及人物：${summary.key_people.join('、')}`

  const completion = await createChatCompletion({
    messages: [{ role: 'user', content: prompt }],
    tier: 'flash',
    systemPrompt: UPDATE_PROFILE_PROMPT,
  }) as { choices: Array<{ message: { content: string } }> }

  const raw = completion.choices[0].message.content.trim()
  const jsonStr = raw.replace(/^```json\s*/, '').replace(/\s*```$/, '')
  return JSON.parse(jsonStr) as UserProfile
}

export const EMPTY_PROFILE: UserProfile = {
  personality: { traits: [], values: [], confidence: 0 },
  patterns: [],
  relationships: [],
  emotional_baseline: { dominant: '未知', triggers: [] },
  life_themes: [],
}
```

---

## Task 5：上下文语义检索

**Files:**
- Create: `lib/ai/context.ts`

### Step 1：写检索逻辑

Create `lib/ai/context.ts`:

```typescript
import { createClient } from '@/lib/supabase/server'
import { generateQueryEmbedding } from './embedding'

export async function retrieveRelevantContext(
  userId: string,
  currentMessage: string,
  limit = 3
): Promise<string> {
  const supabase = await createClient()
  const embedding = await generateQueryEmbedding(currentMessage)

  // pgvector 余弦相似度检索
  const { data } = await supabase.rpc('match_summaries', {
    query_embedding: embedding,
    match_user_id: userId,
    match_count: limit,
  })

  if (!data || data.length === 0) return ''

  const snippets = data.map((row: { summary: string; created_at: string }) => {
    const date = new Date(row.created_at).toLocaleDateString('zh-CN')
    return `[${date}] ${row.summary}`
  })

  return `相关历史片段：\n${snippets.join('\n')}`
}
```

### Step 2：添加 Supabase RPC 函数

在 `002_memory.sql` 末尾追加（或单独 migration）：

```sql
CREATE OR REPLACE FUNCTION match_summaries(
  query_embedding vector(1024),
  match_user_id uuid,
  match_count int DEFAULT 3
)
RETURNS TABLE (
  id uuid,
  summary text,
  created_at timestamptz,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT id, summary, created_at,
    1 - (embedding <=> query_embedding) AS similarity
  FROM public.session_summaries
  WHERE user_id = match_user_id
    AND embedding IS NOT NULL
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;
```

---

## Task 6：摘要触发 API

**Files:**
- Create: `app/api/summarize/route.ts`

### Step 1：写 API 路由

Create `app/api/summarize/route.ts`:

```typescript
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

  // 检查是否已有摘要（避免重复）
  const { data: existing } = await supabase
    .from('session_summaries')
    .select('id')
    .eq('session_id', sessionId)
    .single()

  if (existing) return Response.json({ skipped: true })

  const aiMessages = messages as AIMessage[]

  // 生成摘要
  const summary = await summarizeSession(aiMessages)

  // 生成 embedding
  const embedding = await generateEmbedding(summary.summary)

  // 写入 session_summaries
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
  const { data: profile } = await supabase
    .from('profiles')
    .select('profile_data')
    .eq('id', user.id)
    .single()

  const currentProfile = (profile?.profile_data as UserProfile) ?? EMPTY_PROFILE
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
```

---

## Task 7：增强对话 API（注入画像 + 上下文）

**Files:**
- Modify: `lib/ai/prompts.ts`
- Modify: `app/api/chat/route.ts`

### Step 1：更新 prompts.ts

在 `lib/ai/prompts.ts` 修改 `buildSystemPrompt`：

```typescript
export function buildSystemPrompt(
  scene: string,
  profileSummary?: string,
  relevantContext?: string
): string {
  const style = SCENE_STYLE[scene] ?? SCENE_STYLE.casual
  const profile = profileSummary
    ? `\n\n关于用户的已知画像：\n${profileSummary}`
    : ''
  const context = relevantContext
    ? `\n\n${relevantContext}`
    : ''
  return `${BASE_PERSONA}\n\n${style}${profile}${context}`
}

export function formatProfileForPrompt(profileData: Record<string, unknown>): string {
  if (!profileData || Object.keys(profileData).length === 0) return ''
  const lines: string[] = []
  const p = profileData as import('@/types').UserProfile
  if (p.personality?.traits?.length)
    lines.push(`性格特征：${p.personality.traits.join('、')}`)
  if (p.emotional_baseline?.dominant)
    lines.push(`情绪基调：${p.emotional_baseline.dominant}`)
  if (p.emotional_baseline?.triggers?.length)
    lines.push(`情绪触发点：${p.emotional_baseline.triggers.join('、')}`)
  if (p.patterns?.filter(x => x.confirmed_by_user).length)
    lines.push(`已确认的行为模式：${p.patterns.filter(x => x.confirmed_by_user).map(x => x.description).join('；')}`)
  return lines.join('\n')
}
```

### Step 2：更新 app/api/chat/route.ts

在原有流程基础上，发消息前增加两步：

```typescript
// 加载用户画像
const { data: profileRow } = await supabase
  .from('profiles').select('profile_data').eq('id', user.id).single()
const profileSummary = formatProfileForPrompt(profileRow?.profile_data ?? {})

// 语义检索相关历史
const relevantContext = await retrieveRelevantContext(user.id, message)

const systemPrompt = buildSystemPrompt(scene, profileSummary, relevantContext)
```

---

## Task 8：触发摘要（聊天页面）

**Files:**
- Modify: `app/(app)/chat/page.tsx`

### Step 1：newSession() 中静默触发摘要

修改 `newSession()` 函数，在创建新对话前，对当前 session 静默触发摘要（不 await，不阻塞 UI）：

```typescript
async function newSession() {
  // 静默触发上一个 session 的摘要（不等待结果）
  if (currentSessionId) {
    fetch('/api/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: currentSessionId }),
    }).catch(() => {}) // 静默失败，不影响用户
  }

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  const { data } = await supabase.from('chat_sessions')
    .insert({ title: '新对话', user_id: user.id }).select().single()
  if (data) {
    setSessions([data as ChatSession, ...sessions])
    selectSession(data.id)
  }
}
```

---

## 验收标准

1. `session_summaries` 表创建成功，`profiles.profile_data` 列存在
2. 创建新对话后，上一个 session 在后台被摘要处理（可查 `session_summaries` 表验证）
3. 发消息时，system prompt 中包含用户画像摘要（有对话历史时）
4. 超过 3 次对话后，语义检索能召回相关历史片段

## 环境变量

`.env.local` 需要追加：

```
JINA_API_KEY=your_jina_api_key_here
```

获取：https://jina.ai 免费注册，1M tokens/月，无需信用卡。
