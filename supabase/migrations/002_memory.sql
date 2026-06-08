-- 为 profiles 添加画像数据列
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS profile_data JSONB DEFAULT '{}';

-- 对话摘要表（含向量，维度 1024 对应 Jina jina-embeddings-v3）
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

-- pgvector 语义检索 RPC 函数
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
