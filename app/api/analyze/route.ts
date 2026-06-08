import { createClient } from '@/lib/supabase/server'
import { generateInsightReport } from '@/lib/ai/insights'
import { EMPTY_PROFILE } from '@/lib/ai/profile'
import type { UserProfile, ProfilePattern } from '@/types'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const { data: summaries } = await supabase
    .from('session_summaries')
    .select('summary, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(20)

  if (!summaries || summaries.length < 3) {
    return Response.json({ skipped: true, reason: 'not enough summaries' })
  }

  const { data: profileRow } = await supabase
    .from('profiles')
    .select('profile_data')
    .eq('id', user.id)
    .single()

  const profile = (profileRow?.profile_data as UserProfile | null) ?? EMPTY_PROFILE
  const report = await generateInsightReport(summaries, profile)

  await supabase.from('insight_reports').insert({
    user_id: user.id,
    period_start: summaries[summaries.length - 1].created_at,
    period_end: summaries[0].created_at,
    content: report.content,
    new_patterns: report.new_patterns,
    trends: report.trends,
    pending_confirmations: report.pending_confirmations,
  })

  // new_patterns 回写画像
  if (report.new_patterns.length > 0) {
    const today = new Date().toISOString()
    const existing = profile.patterns ?? []
    const merged = [...existing]
    for (const p of report.new_patterns) {
      const dup = merged.find(e => e.description === p.description)
      if (dup) {
        dup.evidence_count += 1
        dup.last_seen = today
      } else {
        const entry: ProfilePattern = {
          description: p.description,
          evidence_count: 1,
          first_seen: today,
          last_seen: today,
          confirmed_by_user: null,
        }
        merged.push(entry)
      }
    }
    await supabase.from('profiles')
      .update({ profile_data: { ...profile, patterns: merged } })
      .eq('id', user.id)
  }

  await supabase
    .from('profiles')
    .update({ last_analyzed_at: new Date().toISOString() })
    .eq('id', user.id)

  return Response.json({ ok: true })
}
