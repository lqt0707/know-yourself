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

-- profiles 追加计数列
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS session_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_analyzed_at TIMESTAMPTZ;
