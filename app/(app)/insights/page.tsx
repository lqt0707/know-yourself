import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { AnalyzeButton } from './AnalyzeButton'

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
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '1rem' }}>
            <Link href="/chat" style={{
              color: 'var(--warm-text-muted)',
              fontFamily: "'Lora', serif",
              fontSize: '0.8rem',
              textDecoration: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: '0.3rem',
              flexShrink: 0,
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
              返回
            </Link>
            <h1 style={{
              fontFamily: "'Noto Serif SC', serif",
              fontSize: '1.5rem',
              fontWeight: 600,
              color: 'var(--warm-text)',
            }}>洞察报告</h1>
          </div>
          <AnalyzeButton />
        </div>
        <p style={{
          fontFamily: "'Lora', serif",
          fontSize: '0.85rem',
          fontStyle: 'italic',
          color: 'var(--warm-text-muted)',
          marginBottom: '2.5rem',
        }}>来自你对话历史的深度发现</p>

        {!reports || reports.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '4rem 2rem',
            color: 'var(--warm-text-muted)',
            fontFamily: "'Lora', serif",
            fontSize: '0.9rem',
            fontStyle: 'italic',
            lineHeight: 1.8,
          }}>
            还没有洞察报告。<br />
            多聊几次后，知己会开始发现你的规律。
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {reports.map((report) => (
              <article key={report.id} style={{
                background: 'var(--warm-surface)',
                border: '1px solid rgba(120, 70, 30, 0.12)',
                borderRadius: '12px',
                padding: '1.75rem 2rem',
                boxShadow: '0 2px 8px rgba(100, 45, 15, 0.06)',
              }}>
                <div style={{
                  fontFamily: "'Lora', serif",
                  fontSize: '0.72rem',
                  letterSpacing: '0.06em',
                  color: 'var(--warm-text-muted)',
                  marginBottom: '1rem',
                  textTransform: 'uppercase',
                }}>
                  {new Date(report.period_start).toLocaleDateString('zh-CN')}
                  {report.period_start !== report.period_end
                    ? ` — ${new Date(report.period_end).toLocaleDateString('zh-CN')}`
                    : ''}
                </div>
                <div style={{
                  fontFamily: "'Noto Serif SC', serif",
                  fontSize: '0.9rem',
                  lineHeight: 1.9,
                  color: 'var(--warm-text)',
                  whiteSpace: 'pre-wrap',
                }}>
                  {report.content}
                </div>
                {(report.new_patterns as unknown[])?.length > 0 && (
                  <div style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid rgba(120, 70, 30, 0.08)' }}>
                    <div style={{
                      fontFamily: "'Lora', serif",
                      fontSize: '0.72rem',
                      letterSpacing: '0.06em',
                      color: 'var(--warm-text-muted)',
                      marginBottom: '0.6rem',
                      textTransform: 'uppercase',
                    }}>新发现的模式</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                      {(report.new_patterns as Array<{ type: string; description: string }>).map((p, i) => (
                        <div key={i} style={{
                          display: 'flex',
                          gap: '0.6rem',
                          fontSize: '0.83rem',
                          fontFamily: "'Noto Serif SC', serif",
                          color: 'var(--warm-text)',
                          lineHeight: 1.6,
                        }}>
                          <span style={{
                            flexShrink: 0,
                            padding: '0.1rem 0.5rem',
                            borderRadius: '20px',
                            fontSize: '0.68rem',
                            background: 'rgba(192, 120, 80, 0.12)',
                            color: 'var(--warm-accent)',
                            fontFamily: "'Lora', serif",
                            alignSelf: 'flex-start',
                            marginTop: '0.1rem',
                          }}>{p.type}</span>
                          <span>{p.description}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
