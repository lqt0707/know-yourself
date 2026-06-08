# Know Yourself Phase 3 — 洞察能力 Implementation Plan

**Goal:** 在记忆系统基础上，构建洞察分析引擎。每 5 次对话自动触发轻量分析，每周触发深度洞察报告；情绪数据可视化展示；画像确认自然嵌入对话。

**Prerequisites:** Phase 2 已完成（session_summaries + profiles.profile_data + 语义检索）。

**Architecture:** 新增 insight_reports 表 + messages 情绪字段。分析引擎在 chat/route.ts 中计数触发，生成报告写入 DB。前端新增洞察报告页 + 情绪仪表盘页。

---

## File Map（新增/修改）

```
know-yourself/
├── supabase/migrations/
│   └── 003_insights.sql             # 新增：情绪字段 + 洞察报告表
├── lib/ai/
│   └── insights.ts                  # 新增：洞察分析引擎
├── app/api/
│   └── analyze/route.ts             # 新增：分析触发 API
│   └── chat/route.ts                # 修改：情绪标注 + 计数触发分析
├── app/(app)/
│   ├── insights/page.tsx            # 新增：洞察报告列表页
│   └── dashboard/page.tsx           # 新增：情绪仪表盘页
└── app/(app)/chat/
    └── page.tsx                     # 修改：侧边栏加导航入口
```

---

## Task 1：DB Schema 扩展

**Files:**
- Create: `supabase/migrations/003_insights.sql`

### Step 1：写迁移 SQL

Create `supabase/migrations/003_insights.sql`:

```sql
-- messages 追加情绪标注列
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS emotion_label TEXT,
  ADD COLUMN IF NOT EXISTS emotion_intensity FLOAT,
  ADD COLUMN IF NOT EXISTS emotion_trigger TEXT;

-- 洞察报告表
CREATE TABLE public.insight_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  content TEXT NOT NULL,
  new_patterns JSONB DEFAULT '[]',
  trends JSONB DEFAULT '[]',
  pending_confirmations JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.insight_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own reports" ON public.insight_reports
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX insight_reports_user_id_idx ON public.insight_reports(user_id, created_at DESC);

-- 记录每个用户已触发的分析次数（避免重复触发）
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS session_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_analyzed_at TIMESTAMPTZ;
```

### Step 2：通过 Supabase MCP 应用迁移

使用 `mcp__supabase__apply_migration`，name=`003_insights`。

Expected：`messages` 新增 3 个情绪列；`insight_reports` 表创建成功；`profiles` 新增计数列。

---

## Task 2：情绪标注

**Files:**
- Modify: `app/api/chat/route.ts`

### Step 1：情绪标注逻辑

在 `app/api/chat/route.ts` 中，用户消息写入后，异步（非阻塞，不影响流式输出）做情绪标注。

在路由文件顶部添加情绪标注函数：

```typescript
async function annotateEmotion(
  supabase: ReturnType<typeof createClient>,
  messageId: string,
  content: string
) {
  const EMOTION_PROMPT = `分析这条消息的情绪。只返回 JSON：
{"emotion": "情绪名称（如：焦虑、平静、开心）", "intensity": 0.0-1.0, "trigger": "触发原因（简短，10字内，无则返回null）"}`

  const completion = await createChatCompletion({
    messages: [{ role: 'user', content }],
    tier: 'flash',
    systemPrompt: EMOTION_PROMPT,
  }) as { choices: Array<{ message: { content: string } }> }

  const raw = completion.choices[0].message.content.trim()
  const jsonStr = raw.replace(/^```json\s*/, '').replace(/\s*```$/, '')
  const { emotion, intensity, trigger } = JSON.parse(jsonStr)

  const client = await supabase
  await client.from('messages').update({
    emotion_label: emotion,
    emotion_intensity: intensity,
    emotion_trigger: trigger ?? null,
  }).eq('id', messageId)
}
```

在用户消息写入后触发（不 await）：

```typescript
const { data: userMsg } = await supabase.from('messages').insert({...}).select().single()
if (userMsg) annotateEmotion(createClient, userMsg.id, message).catch(() => {})
```

---

## Task 3：洞察分析引擎

**Files:**
- Create: `lib/ai/insights.ts`

### Step 1：写分析引擎

Create `lib/ai/insights.ts`:

```typescript
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
  "content": "完整的洞察报告正文（Markdown 格式，200-400字）",
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
  const jsonStr = raw.replace(/^```json\s*/, '').replace(/\s*```$/, '')
  return JSON.parse(jsonStr) as InsightReport
}
```

---

## Task 4：分析触发 API

**Files:**
- Create: `app/api/analyze/route.ts`

### Step 1：写分析 API

Create `app/api/analyze/route.ts`:

```typescript
import { createClient } from '@/lib/supabase/server'
import { generateInsightReport } from '@/lib/ai/insights'
import type { UserProfile } from '@/types'
import { EMPTY_PROFILE } from '@/lib/ai/profile'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  // 加载最近 20 条摘要
  const { data: summaries } = await supabase
    .from('session_summaries')
    .select('summary, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(20)

  if (!summaries || summaries.length < 3) {
    return Response.json({ skipped: true, reason: 'not enough summaries' })
  }

  // 加载用户画像
  const { data: profileRow } = await supabase
    .from('profiles')
    .select('profile_data')
    .eq('id', user.id)
    .single()

  const profile = (profileRow?.profile_data as UserProfile) ?? EMPTY_PROFILE

  // 生成洞察报告
  const report = await generateInsightReport(summaries, profile)

  const periodStart = summaries[summaries.length - 1].created_at
  const periodEnd = summaries[0].created_at

  await supabase.from('insight_reports').insert({
    user_id: user.id,
    period_start: periodStart,
    period_end: periodEnd,
    content: report.content,
    new_patterns: report.new_patterns,
    trends: report.trends,
    pending_confirmations: report.pending_confirmations,
  })

  // 更新 last_analyzed_at
  await supabase
    .from('profiles')
    .update({ last_analyzed_at: new Date().toISOString() })
    .eq('id', user.id)

  return Response.json({ ok: true })
}
```

### Step 2：在 chat/route.ts 中计数触发

在 `app/api/chat/route.ts` 对话完成后追加触发逻辑：

```typescript
// assistant 消息写入后，检查是否触发分析
const { count } = await supabase
  .from('messages')
  .select('*', { count: 'exact', head: true })
  .eq('user_id', user.id)
  .eq('role', 'assistant')

// 每 5 条 assistant 消息触发一次分析（静默，不阻塞响应）
if (count && count % 5 === 0) {
  fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL?.replace('.supabase.co', '')}/api/analyze`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${/* user token */}` },
  }).catch(() => {})
}
```

Note：触发方式改用内部调用 `generateInsightReport` 更简洁，在 route.ts 里直接判断计数 + 调用 insights.ts 即可，避免跨域 token 传递问题。具体实现时直接在 route.ts 中 import insights.ts 并 `void analyze()` 异步触发。

---

## Task 5：洞察报告页

**Files:**
- Create: `app/(app)/insights/page.tsx`

### Step 1：写洞察报告页

Create `app/(app)/insights/page.tsx`:

```typescript
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function InsightsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: reports } = await supabase
    .from('insight_reports')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  return (
    <main className="flex-1 overflow-y-auto p-8" style={{ background: 'var(--warm-bg)' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <h1 style={{
          fontFamily: "'Noto Serif SC', serif",
          fontSize: '1.5rem',
          fontWeight: 600,
          color: 'var(--warm-text)',
          marginBottom: '0.5rem',
        }}>洞察报告</h1>
        <p style={{
          fontFamily: "'Lora', serif",
          fontSize: '0.85rem',
          fontStyle: 'italic',
          color: 'var(--warm-text-muted)',
          marginBottom: '2rem',
        }}>来自你对话历史的深度发现</p>

        {!reports || reports.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '3rem',
            color: 'var(--warm-text-muted)',
            fontFamily: "'Lora', serif",
            fontSize: '0.9rem',
            fontStyle: 'italic',
          }}>
            还没有洞察报告。多聊几次后，知己会开始发现你的规律。
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {reports.map((report) => (
              <article key={report.id} style={{
                background: 'var(--warm-surface)',
                border: '1px solid rgba(120, 70, 30, 0.12)',
                borderRadius: '12px',
                padding: '1.5rem 2rem',
                boxShadow: '0 2px 8px rgba(100, 45, 15, 0.06)',
              }}>
                <div style={{
                  fontFamily: "'Lora', serif",
                  fontSize: '0.75rem',
                  color: 'var(--warm-text-muted)',
                  marginBottom: '1rem',
                }}>
                  {new Date(report.period_start).toLocaleDateString('zh-CN')} — {new Date(report.period_end).toLocaleDateString('zh-CN')}
                </div>
                <div style={{
                  fontFamily: "'Noto Serif SC', serif",
                  fontSize: '0.9rem',
                  lineHeight: 1.8,
                  color: 'var(--warm-text)',
                  whiteSpace: 'pre-wrap',
                }}>
                  {report.content}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
```

---

## Task 6：侧边栏导航更新

**Files:**
- Modify: `app/(app)/chat/page.tsx`

### Step 1：添加洞察 + 仪表盘导航入口

在侧边栏底部退出登录按钮上方，加两个导航按钮：

```typescript
import Link from 'next/link'

// 在 sidebar 底部区域加：
<div style={{ borderTop: '1px solid rgba(120, 70, 30, 0.1)', paddingTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
  <Link href="/insights" style={{ /* 同 btn-logout 样式 */ }}>
    ◆ 洞察报告
  </Link>
  <Link href="/dashboard" style={{ /* 同 btn-logout 样式 */ }}>
    ◇ 情绪仪表盘
  </Link>
  <button className="btn-logout" onClick={handleSignOut}>↩ 退出登录</button>
</div>
```

---

## Task 7：情绪仪表盘

**Files:**
- Create: `app/(app)/dashboard/page.tsx`

### Step 1：安装 Recharts

```bash
npm install recharts
npm install --save-dev @types/recharts
```

### Step 2：写仪表盘页

Create `app/(app)/dashboard/page.tsx`:

```typescript
'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
  BarChart, Bar,
} from 'recharts'

interface EmotionRecord {
  created_at: string
  emotion_label: string
  emotion_intensity: number
  emotion_trigger: string | null
}

const EMOTION_COLORS: Record<string, string> = {
  焦虑: '#C07850', 开心: '#7A9E7E', 平静: '#8BA3B8',
  悲伤: '#7A6080', 愤怒: '#C05050', 兴奋: '#C0A030',
}
const DEFAULT_COLOR = '#B8A898'

export default function DashboardPage() {
  const [records, setRecords] = useState<EmotionRecord[]>([])
  const [timeRange, setTimeRange] = useState<'week' | 'month'>('week')

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const since = new Date()
      since.setDate(since.getDate() - (timeRange === 'week' ? 7 : 30))

      const { data } = await supabase
        .from('messages')
        .select('created_at, emotion_label, emotion_intensity, emotion_trigger')
        .eq('role', 'user')
        .not('emotion_label', 'is', null)
        .gte('created_at', since.toISOString())
        .order('created_at', { ascending: true })

      if (data) setRecords(data as EmotionRecord[])
    }
    load()
  }, [timeRange])

  // 情绪时间线数据
  const timelineData = records.map(r => ({
    date: new Date(r.created_at).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }),
    intensity: r.emotion_intensity,
    emotion: r.emotion_label,
  }))

  // 情绪分布
  const distribution = Object.entries(
    records.reduce<Record<string, number>>((acc, r) => {
      acc[r.emotion_label] = (acc[r.emotion_label] ?? 0) + 1
      return acc
    }, {})
  ).map(([name, value]) => ({ name, value }))

  // 触发因素 Top 5
  const triggers = Object.entries(
    records.filter(r => r.emotion_trigger).reduce<Record<string, number>>((acc, r) => {
      const t = r.emotion_trigger!
      acc[t] = (acc[t] ?? 0) + 1
      return acc
    }, {})
  ).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, count }))

  const chartStyle = {
    fontFamily: "'Lora', serif",
    fontSize: '0.75rem',
    color: 'var(--warm-text-muted)',
  }

  return (
    <main className="flex-1 overflow-y-auto p-8" style={{ background: 'var(--warm-bg)' }}>
      <div style={{ maxWidth: 800, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '1rem', marginBottom: '2rem' }}>
          <h1 style={{
            fontFamily: "'Noto Serif SC', serif",
            fontSize: '1.5rem', fontWeight: 600, color: 'var(--warm-text)',
          }}>情绪仪表盘</h1>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {(['week', 'month'] as const).map(r => (
              <button key={r} onClick={() => setTimeRange(r)} style={{
                padding: '0.2rem 0.75rem',
                borderRadius: '20px',
                border: '1px solid rgba(120, 70, 30, 0.2)',
                background: timeRange === r ? 'var(--warm-accent)' : 'transparent',
                color: timeRange === r ? '#FDF6EE' : 'var(--warm-text-muted)',
                fontFamily: "'Lora', serif",
                fontSize: '0.78rem',
                cursor: 'pointer',
              }}>
                {r === 'week' ? '近一周' : '近一月'}
              </button>
            ))}
          </div>
        </div>

        {records.length === 0 ? (
          <p style={{ color: 'var(--warm-text-muted)', fontStyle: 'italic', fontFamily: "'Lora', serif" }}>
            暂无情绪数据，开始对话后这里会显示你的情绪规律。
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            {/* 情绪时间线 */}
            <section style={{ background: 'var(--warm-surface)', borderRadius: '12px', padding: '1.5rem' }}>
              <h2 style={{ fontFamily: "'Noto Serif SC', serif", fontSize: '1rem', color: 'var(--warm-text)', marginBottom: '1rem' }}>
                情绪波动
              </h2>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={timelineData}>
                  <XAxis dataKey="date" tick={chartStyle} />
                  <YAxis domain={[0, 1]} tick={chartStyle} />
                  <Tooltip
                    contentStyle={{ background: 'var(--warm-surface)', border: '1px solid rgba(120,70,30,0.15)', borderRadius: 8 }}
                    formatter={(v: number, _: string, props) => [
                      `${(v * 100).toFixed(0)}%`, props.payload.emotion
                    ]}
                  />
                  <Line type="monotone" dataKey="intensity" stroke="var(--warm-accent)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </section>

            {/* 情绪分布 + 触发因素 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
              <section style={{ background: 'var(--warm-surface)', borderRadius: '12px', padding: '1.5rem' }}>
                <h2 style={{ fontFamily: "'Noto Serif SC', serif", fontSize: '1rem', color: 'var(--warm-text)', marginBottom: '1rem' }}>
                  情绪分布
                </h2>
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={distribution} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={65} label={({ name }) => name}>
                      {distribution.map((entry) => (
                        <Cell key={entry.name} fill={EMOTION_COLORS[entry.name] ?? DEFAULT_COLOR} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </section>

              <section style={{ background: 'var(--warm-surface)', borderRadius: '12px', padding: '1.5rem' }}>
                <h2 style={{ fontFamily: "'Noto Serif SC', serif", fontSize: '1rem', color: 'var(--warm-text)', marginBottom: '1rem' }}>
                  触发因素
                </h2>
                {triggers.length === 0 ? (
                  <p style={{ color: 'var(--warm-text-muted)', fontStyle: 'italic', fontSize: '0.8rem', fontFamily: "'Lora', serif" }}>
                    暂无数据
                  </p>
                ) : (
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={triggers} layout="vertical">
                      <XAxis type="number" tick={chartStyle} />
                      <YAxis type="category" dataKey="name" tick={chartStyle} width={80} />
                      <Tooltip />
                      <Bar dataKey="count" fill="var(--warm-accent)" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </section>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
```

---

## Task 8：画像确认机制

**Files:**
- Modify: `app/api/chat/route.ts`

### Step 1：确认问句注入逻辑

在 `app/api/chat/route.ts` 中，对话完成后检查是否有待确认的洞察：

```typescript
// 检查最新洞察报告的 pending_confirmations
const { data: latestReport } = await supabase
  .from('insight_reports')
  .select('pending_confirmations')
  .eq('user_id', user.id)
  .order('created_at', { ascending: false })
  .limit(1)
  .single()

const pending = latestReport?.pending_confirmations as Array<{ question: string; pattern_description: string }>

// 每隔 3 条消息检查一次，有待确认项时追加到 AI 回复末尾
const shouldConfirm = count && count % 3 === 0 && pending?.length > 0
```

在流式输出结束后，若 `shouldConfirm` 为 true，追加一条分隔线 + 确认问句，然后清空该条 pending。

---

## 验收标准

1. 每条用户消息发送后，`messages.emotion_label` 在后台被异步填充
2. 累计 5 次 AI 回复后，`insight_reports` 表出现新记录
3. `/insights` 页面正确展示洞察报告列表（暖纸风格卡片）
4. `/dashboard` 页面展示情绪时间线、分布饼图、触发因素条形图
5. 侧边栏新增"洞察报告"和"情绪仪表盘"导航入口

## 依赖

- Phase 2 全部完成（session_summaries 需有数据，分析引擎才有意义）
- Recharts：`npm install recharts`
