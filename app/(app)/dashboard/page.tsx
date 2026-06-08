'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
  BarChart, Bar,
} from 'recharts'
interface EmotionRecord {
  created_at: string
  emotion_label: string
  emotion_intensity: number
  emotion_trigger: string | null
  session_id: string
}

const EMOTION_COLORS: Record<string, string> = {
  焦虑: '#9A5430', 开心: '#5C8C60', 平静: '#5A7898',
  悲伤: '#6A5070', 愤怒: '#A03838', 兴奋: '#9A8020',
  孤独: '#7A6A8A', 疲惫: '#8A7862', 期待: '#4A8A96',
}
const DEFAULT_COLOR = '#9A8070'

const cardStyle: React.CSSProperties = {
  background: 'var(--warm-surface)',
  border: '1px solid rgba(120, 70, 30, 0.12)',
  borderRadius: '12px',
  padding: '1.5rem',
  boxShadow: '0 2px 8px rgba(100, 45, 15, 0.06)',
}

const sectionTitle: React.CSSProperties = {
  fontFamily: "'Noto Serif SC', serif",
  fontSize: '0.95rem',
  fontWeight: 500,
  color: 'var(--warm-text)',
  marginBottom: '1rem',
}

const tickStyle = { fontFamily: "'Lora', serif", fontSize: 11, fill: 'var(--warm-text-muted)' }

export default function DashboardPage() {
  const [records, setRecords] = useState<EmotionRecord[]>([])
  const [timeRange, setTimeRange] = useState<'week' | 'month'>('week')
  const router = useRouter()

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const since = new Date()
      since.setDate(since.getDate() - (timeRange === 'week' ? 7 : 30))
      const { data } = await supabase
        .from('messages')
        .select('created_at, emotion_label, emotion_intensity, emotion_trigger, session_id')
        .eq('role', 'user')
        .not('emotion_label', 'is', null)
        .gte('created_at', since.toISOString())
        .order('created_at', { ascending: true })
      if (data) setRecords(data as EmotionRecord[])
    }
    load()
  }, [timeRange])

  const timelineData = records.map(r => ({
    date: new Date(r.created_at).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }),
    intensity: Number(r.emotion_intensity?.toFixed(2)),
    emotion: r.emotion_label,
    session_id: r.session_id,
  }))

  const distribution = Object.entries(
    records.reduce<Record<string, number>>((acc, r) => {
      if (r.emotion_label) acc[r.emotion_label] = (acc[r.emotion_label] ?? 0) + 1
      return acc
    }, {})
  ).map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)

  const triggers = Object.entries(
    records.filter(r => r.emotion_trigger).reduce<Record<string, number>>((acc, r) => {
      const t = r.emotion_trigger!
      acc[t] = (acc[t] ?? 0) + 1
      return acc
    }, {})
  ).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, count }))

  return (
    <main className="flex-1 overflow-y-auto p-8" style={{ background: 'var(--warm-bg)' }}>
      <div style={{ maxWidth: 820, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '1rem', marginBottom: '2.5rem' }}>
          <button
            onClick={() => router.push('/chat')}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--warm-text-muted)',
              fontFamily: "'Lora', serif",
              fontSize: '0.8rem',
              padding: '0.2rem 0',
              display: 'flex',
              alignItems: 'center',
              gap: '0.3rem',
              flexShrink: 0,
              transition: 'color 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--warm-accent)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--warm-text-muted)')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
            返回
          </button>
          <h1 style={{
            fontFamily: "'Noto Serif SC', serif",
            fontSize: '1.5rem',
            fontWeight: 600,
            color: 'var(--warm-text)',
          }}>情绪仪表盘</h1>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            {(['week', 'month'] as const).map(r => (
              <button key={r} onClick={() => setTimeRange(r)} style={{
                padding: '0.18rem 0.8rem',
                borderRadius: '20px',
                border: '1px solid rgba(120, 70, 30, 0.2)',
                background: timeRange === r ? 'var(--warm-accent)' : 'transparent',
                color: timeRange === r ? '#FDF6EE' : 'var(--warm-text-muted)',
                fontFamily: "'Lora', serif",
                fontSize: '0.78rem',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}>
                {r === 'week' ? '近一周' : '近一月'}
              </button>
            ))}
          </div>
        </div>

        {records.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '4rem 2rem',
            color: 'var(--warm-text-muted)',
            fontFamily: "'Lora', serif",
            fontSize: '0.9rem',
            fontStyle: 'italic',
            lineHeight: 1.8,
          }}>
            暂无情绪数据。<br />
            开始对话后，这里会显示你的情绪规律。
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <section style={cardStyle}>
              <h2 style={sectionTitle}>情绪波动
                <span style={{ marginLeft: '0.5rem', fontFamily: "'Lora', serif", fontSize: '0.68rem', fontWeight: 400, color: 'var(--warm-text-muted)', fontStyle: 'italic' }}>
                  点击数据点查看当时对话
                </span>
              </h2>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart
                  data={timelineData}
                  margin={{ top: 4, right: 8, bottom: 4, left: -20 }}
                  onClick={(e) => {
                    const payload = (e as unknown as { activePayload?: Array<{ payload: { session_id?: string } }> })?.activePayload
                    const sid = payload?.[0]?.payload?.session_id
                    if (sid) router.push(`/chat?session=${sid}`)
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <XAxis dataKey="date" tick={tickStyle} />
                  <YAxis domain={[0, 1]} tick={tickStyle} tickFormatter={v => `${Math.round(v * 100)}%`} />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--warm-surface)',
                      border: '1px solid rgba(120,70,30,0.15)',
                      borderRadius: 8,
                      fontFamily: "'Noto Serif SC', serif",
                      fontSize: 12,
                    }}
                    content={({ payload }) => {
                      if (!payload?.length) return null
                      const p = payload[0]
                      const emotion = (p.payload as { emotion?: string })?.emotion ?? '情绪强度'
                      return (
                        <div style={{ padding: '6px 10px', background: 'var(--warm-surface)', border: '1px solid rgba(120,70,30,0.15)', borderRadius: 8, fontFamily: "'Noto Serif SC', serif", fontSize: 12 }}>
                          <div style={{ color: 'var(--warm-accent)' }}>{emotion}</div>
                          <div style={{ color: 'var(--warm-text)' }}>{Math.round((Number(p.value) || 0) * 100)}%</div>
                        </div>
                      )
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="intensity"
                    stroke="var(--warm-accent)"
                    strokeWidth={2}
                    dot={{ r: 3, fill: 'var(--warm-accent)', strokeWidth: 0 }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </section>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
              <section style={cardStyle}>
                <h2 style={sectionTitle}>情绪分布</h2>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={distribution}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={72}
                      label={({ name, percent }) => percent && percent > 0.05 ? `${name} ${Math.round(percent * 100)}%` : ''}
                      labelLine={false}
                    >
                      {distribution.map((entry) => (
                        <Cell key={entry.name} fill={EMOTION_COLORS[entry.name] ?? DEFAULT_COLOR} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        background: 'var(--warm-surface)',
                        border: '1px solid rgba(120,70,30,0.15)',
                        borderRadius: 8,
                        fontFamily: "'Noto Serif SC', serif",
                        fontSize: 12,
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </section>

              <section style={cardStyle}>
                <h2 style={sectionTitle}>触发因素 Top 5</h2>
                {triggers.length === 0 ? (
                  <p style={{
                    color: 'var(--warm-text-muted)',
                    fontStyle: 'italic',
                    fontSize: '0.82rem',
                    fontFamily: "'Lora', serif",
                    marginTop: '1rem',
                  }}>暂无数据</p>
                ) : (
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={triggers} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }}>
                      <XAxis type="number" tick={tickStyle} allowDecimals={false} />
                      <YAxis type="category" dataKey="name" tick={tickStyle} width={72} />
                      <Tooltip
                        contentStyle={{
                          background: 'var(--warm-surface)',
                          border: '1px solid rgba(120,70,30,0.15)',
                          borderRadius: 8,
                          fontFamily: "'Noto Serif SC', serif",
                          fontSize: 12,
                        }}
                      />
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
