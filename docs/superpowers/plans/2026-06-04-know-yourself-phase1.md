# Know Yourself Phase 1 — 基础可用 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a working Next.js app with Supabase auth, streaming AI chat via DeepSeek, and conversation storage.

**Architecture:** Next.js 14 App Router with Supabase for auth + data. AI calls go through a unified abstraction layer that routes to DeepSeek V4 Flash (light) or V4 Pro (deep). Conversations stream via SSE from a Route Handler and are stored per user in Postgres with RLS.

**Tech Stack:** Next.js 14, TypeScript, Tailwind CSS, shadcn/ui, Supabase (Auth + Postgres), DeepSeek API, zustand, Vercel

---

## File Map

```
know-yourself/
├── app/
│   ├── layout.tsx                    # Root layout with providers
│   ├── page.tsx                      # Landing / redirect to /chat
│   ├── (auth)/
│   │   ├── login/page.tsx            # Login form
│   │   └── register/page.tsx         # Register form
│   ├── (app)/
│   │   ├── layout.tsx                # App shell with sidebar
│   │   └── chat/
│   │       ├── page.tsx              # Chat page
│   │       └── [sessionId]/page.tsx  # Specific session
│   └── api/
│       ├── chat/route.ts             # Streaming chat endpoint
│       └── auth/callback/route.ts    # Supabase OAuth callback
├── components/
│   ├── chat/
│   │   ├── ChatWindow.tsx            # Message list
│   │   ├── MessageBubble.tsx         # Single message
│   │   └── ChatInput.tsx             # Input bar
│   └── ui/                           # shadcn components (auto-generated)
├── lib/
│   ├── supabase/
│   │   ├── client.ts                 # Browser Supabase client
│   │   ├── server.ts                 # Server Supabase client
│   │   └── middleware.ts             # Auth middleware helper
│   ├── ai/
│   │   ├── client.ts                 # AI abstraction layer
│   │   ├── router.ts                 # Model routing logic (Flash vs Pro)
│   │   └── prompts.ts                # System prompts
│   └── stores/
│       └── chat.ts                   # zustand chat store
├── middleware.ts                     # Next.js middleware (auth guard)
├── supabase/
│   └── migrations/
│       └── 001_initial.sql           # DB schema
├── .env.local                        # Local env vars (gitignored)
└── types/
    └── index.ts                      # Shared TypeScript types
```

---

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `tailwind.config.ts`, `next.config.ts`
- Create: `.env.local` (gitignored)
- Create: `types/index.ts`

- [ ] **Step 1: Bootstrap Next.js project**

```bash
cd /Users/macos/Desktop/project/know-yourself
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir=no --import-alias="@/*" --use-npm
```

Expected: project files created, `npm run dev` works at http://localhost:3000

- [ ] **Step 2: Install dependencies**

```bash
npm install @supabase/supabase-js @supabase/ssr zustand
npm install openai  # DeepSeek uses OpenAI-compatible SDK
npx shadcn@latest init
```

When shadcn asks: style=Default, base color=Neutral, CSS variables=yes.

- [ ] **Step 3: Install shadcn components we'll need**

```bash
npx shadcn@latest add button input textarea card avatar scroll-area separator
```

- [ ] **Step 4: Create shared TypeScript types**

Create `types/index.ts`:

```typescript
export type MessageRole = 'user' | 'assistant'

export interface Message {
  id: string
  session_id: string
  user_id: string
  role: MessageRole
  content: string
  created_at: string
}

export interface ChatSession {
  id: string
  user_id: string
  title: string | null
  created_at: string
  last_message_at: string
}

export type ModelTier = 'flash' | 'pro'

export interface AIMessage {
  role: MessageRole
  content: string
}
```

- [ ] **Step 5: Create .env.local with placeholders**

Create `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url_here
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key_here
DEEPSEEK_API_KEY=your_deepseek_api_key_here
```

Note: Fill in real values before running. Do NOT commit this file.

- [ ] **Step 6: Commit scaffold**

```bash
git add -A -- ':!.env.local'
git commit -m "feat: project scaffold — Next.js 14 + shadcn/ui + dependencies"
```

---

### Task 2: Supabase Database Schema

**Files:**
- Create: `supabase/migrations/001_initial.sql`

- [ ] **Step 1: Write migration**

Create `supabase/migrations/001_initial.sql`:

```sql
-- Enable pgvector (needed in Phase 2, enable now)
create extension if not exists vector;

-- Users table is managed by Supabase Auth (auth.users)
-- We create a public profile that mirrors it

create table public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  email text not null,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
create policy "Users can view own profile" on public.profiles
  for select using (auth.uid() = id);
create policy "Users can update own profile" on public.profiles
  for update using (auth.uid() = id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Chat sessions
create table public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  title text,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

alter table public.chat_sessions enable row level security;
create policy "Users can manage own sessions" on public.chat_sessions
  for all using (auth.uid() = user_id);

-- Messages
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.chat_sessions(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

alter table public.messages enable row level security;
create policy "Users can manage own messages" on public.messages
  for all using (auth.uid() = user_id);

-- Index for fast session message lookup
create index messages_session_id_idx on public.messages(session_id, created_at);
```

- [ ] **Step 2: Apply migration via Supabase MCP or CLI**

If using Supabase MCP (already authenticated):
- Use `mcp__supabase__apply_migration` with the SQL above and name `001_initial`

If using CLI:
```bash
supabase db push
```

Expected: tables `profiles`, `chat_sessions`, `messages` exist with RLS enabled.

- [ ] **Step 3: Commit migration**

```bash
git add supabase/
git commit -m "feat: initial database schema — profiles, sessions, messages with RLS"
```

---

### Task 3: Supabase Client Setup

**Files:**
- Create: `lib/supabase/client.ts`
- Create: `lib/supabase/server.ts`
- Create: `middleware.ts`

- [ ] **Step 1: Write browser Supabase client**

Create `lib/supabase/client.ts`:

```typescript
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
```

- [ ] **Step 2: Write server Supabase client**

Create `lib/supabase/server.ts`:

```typescript
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Server Component — cookies set by middleware instead
          }
        },
      },
    }
  )
}
```

- [ ] **Step 3: Write auth middleware**

Create `middleware.ts` at project root:

```typescript
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const isAuthRoute = request.nextUrl.pathname.startsWith('/login') ||
    request.nextUrl.pathname.startsWith('/register')

  if (!user && !isAuthRoute) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (user && isAuthRoute) {
    return NextResponse.redirect(new URL('/chat', request.url))
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/auth).*)'],
}
```

- [ ] **Step 4: Commit**

```bash
git add lib/supabase/ middleware.ts
git commit -m "feat: Supabase client setup — browser, server, auth middleware"
```

---

### Task 4: Auth Pages

**Files:**
- Create: `app/(auth)/login/page.tsx`
- Create: `app/(auth)/register/page.tsx`
- Create: `app/api/auth/callback/route.ts`
- Modify: `app/layout.tsx`

- [ ] **Step 1: Write auth callback route**

Create `app/api/auth/callback/route.ts`:

```typescript
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  if (code) {
    const supabase = await createClient()
    await supabase.auth.exchangeCodeForSession(code)
  }

  return NextResponse.redirect(`${origin}/chat`)
}
```

- [ ] **Step 2: Write login page**

Create `app/(auth)/login/page.tsx`:

```typescript
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    router.push('/chat')
    router.refresh()
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">登录</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              type="email"
              placeholder="邮箱"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
            />
            <Input
              type="password"
              placeholder="密码"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
            {error && <p className="text-sm text-red-500">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? '登录中...' : '登录'}
            </Button>
          </form>
          <p className="mt-4 text-sm text-center text-muted-foreground">
            没有账号？{' '}
            <Link href="/register" className="underline">
              注册
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 3: Write register page**

Create `app/(auth)/register/page.tsx`:

```typescript
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function RegisterPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/api/auth/callback` },
    })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    setSuccess(true)
    setLoading(false)
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardContent className="pt-6 text-center">
            <p className="text-lg font-medium">验证邮件已发送</p>
            <p className="mt-2 text-sm text-muted-foreground">
              请检查 {email} 的收件箱并点击链接激活账号。
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">注册</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              type="email"
              placeholder="邮箱"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
            />
            <Input
              type="password"
              placeholder="密码（至少 8 位）"
              value={password}
              onChange={e => setPassword(e.target.value)}
              minLength={8}
              required
            />
            {error && <p className="text-sm text-red-500">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? '注册中...' : '注册'}
            </Button>
          </form>
          <p className="mt-4 text-sm text-center text-muted-foreground">
            已有账号？{' '}
            <Link href="/login" className="underline">
              登录
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add app/
git commit -m "feat: auth pages — login, register, OAuth callback"
```

---

### Task 5: AI Abstraction Layer

**Files:**
- Create: `lib/ai/client.ts`
- Create: `lib/ai/router.ts`
- Create: `lib/ai/prompts.ts`

- [ ] **Step 1: Write AI client abstraction**

Create `lib/ai/client.ts`:

```typescript
import OpenAI from 'openai'
import type { ModelTier, AIMessage } from '@/types'

const deepseek = new OpenAI({
  baseURL: 'https://api.deepseek.com',
  apiKey: process.env.DEEPSEEK_API_KEY!,
})

const MODEL_MAP: Record<ModelTier, string> = {
  flash: 'deepseek-chat',
  pro: 'deepseek-reasoner',
}

export interface ChatCompletionOptions {
  messages: AIMessage[]
  tier: ModelTier
  systemPrompt: string
  stream?: boolean
}

export async function createChatCompletion(options: ChatCompletionOptions) {
  const { messages, tier, systemPrompt, stream = false } = options
  return deepseek.chat.completions.create({
    model: MODEL_MAP[tier],
    messages: [{ role: 'system', content: systemPrompt }, ...messages],
    stream,
    max_tokens: tier === 'pro' ? 4096 : 2048,
  })
}
```

- [ ] **Step 2: Write model routing logic**

Create `lib/ai/router.ts`:

```typescript
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
```

- [ ] **Step 3: Write system prompts**

Create `lib/ai/prompts.ts`:

```typescript
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

export function buildSystemPrompt(scene: string, profileSummary?: string): string {
  const style = SCENE_STYLE[scene] ?? SCENE_STYLE.casual
  const profile = profileSummary ? `\n\n关于用户的已知信息：\n${profileSummary}` : ''
  return `${BASE_PERSONA}\n\n${style}${profile}`
}
```

- [ ] **Step 4: Commit**

```bash
git add lib/ai/
git commit -m "feat: AI abstraction layer — DeepSeek client, model router, system prompts"
```

---

### Task 6: Streaming Chat API Route

**Files:**
- Create: `app/api/chat/route.ts`

- [ ] **Step 1: Write streaming route handler**

Create `app/api/chat/route.ts`:

```typescript
import { createClient } from '@/lib/supabase/server'
import { classifyMessage } from '@/lib/ai/router'
import { buildSystemPrompt } from '@/lib/ai/prompts'
import { createChatCompletion } from '@/lib/ai/client'
import type { AIMessage } from '@/types'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const { message, sessionId, history } = await request.json() as {
    message: string; sessionId: string; history: AIMessage[]
  }

  const { data: session } = await supabase
    .from('chat_sessions').select('id')
    .eq('id', sessionId).eq('user_id', user.id).single()
  if (!session) return new Response('Session not found', { status: 404 })

  await supabase.from('messages').insert({
    session_id: sessionId, user_id: user.id, role: 'user', content: message,
  })

  const { scene, tier } = await classifyMessage(message)
  const systemPrompt = buildSystemPrompt(scene)
  const messages: AIMessage[] = [...history.slice(-10), { role: 'user', content: message }]

  const stream = await createChatCompletion({ messages, tier, systemPrompt, stream: true }) as
    AsyncIterable<{ choices: Array<{ delta: { content?: string }; finish_reason: string | null }> }>

  let fullContent = ''
  const readable = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      try {
        for await (const chunk of stream) {
          const text = chunk.choices[0]?.delta?.content ?? ''
          if (text) {
            fullContent += text
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`))
          }
          if (chunk.choices[0]?.finish_reason === 'stop') {
            await supabase.from('messages').insert({
              session_id: sessionId, user_id: user.id, role: 'assistant', content: fullContent,
            })
            await supabase.from('chat_sessions')
              .update({ last_message_at: new Date().toISOString() }).eq('id', sessionId)
            controller.enqueue(encoder.encode(`data: [DONE]\n\n`))
            controller.close()
          }
        }
      } catch (err) { controller.error(err) }
    },
  })

  return new Response(readable, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
  })
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/chat/
git commit -m "feat: streaming chat API route with model routing and message persistence"
```

---

### Task 7: zustand Chat Store

**Files:**
- Create: `lib/stores/chat.ts`

- [ ] **Step 1: Write chat store**

Create `lib/stores/chat.ts`:

```typescript
import { create } from 'zustand'
import type { Message, ChatSession } from '@/types'

interface ChatState {
  sessions: ChatSession[]
  currentSessionId: string | null
  messages: Message[]
  isStreaming: boolean
  streamingContent: string
  setSessions: (sessions: ChatSession[]) => void
  setCurrentSession: (sessionId: string) => void
  setMessages: (messages: Message[]) => void
  addMessage: (message: Message) => void
  setStreaming: (streaming: boolean) => void
  appendStreamingContent: (text: string) => void
  clearStreamingContent: () => void
}

export const useChatStore = create<ChatState>((set) => ({
  sessions: [], currentSessionId: null, messages: [], isStreaming: false, streamingContent: '',
  setSessions: (sessions) => set({ sessions }),
  setCurrentSession: (sessionId) => set({ currentSessionId: sessionId }),
  setMessages: (messages) => set({ messages }),
  addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
  setStreaming: (streaming) => set({ isStreaming: streaming }),
  appendStreamingContent: (text) => set((state) => ({ streamingContent: state.streamingContent + text })),
  clearStreamingContent: () => set({ streamingContent: '' }),
}))
```

- [ ] **Step 2: Commit**

```bash
git add lib/stores/
git commit -m "feat: zustand chat store"
```

---

### Task 8: Chat UI Components

**Files:**
- Create: `components/chat/MessageBubble.tsx`
- Create: `components/chat/ChatWindow.tsx`
- Create: `components/chat/ChatInput.tsx`

Note: Visual design (colors, typography, warm aesthetic) will be handled by the frontend-design skill separately. These components establish structure and logic; styling will be applied on top.

- [ ] **Step 1: Write MessageBubble**

Create `components/chat/MessageBubble.tsx`:

```typescript
import { cn } from '@/lib/utils'
import type { MessageRole } from '@/types'

interface Props { role: MessageRole; content: string; isStreaming?: boolean }

export function MessageBubble({ role, content, isStreaming }: Props) {
  const isUser = role === 'user'
  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div className={cn(
        'max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed',
        isUser ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground',
        isStreaming && 'after:inline-block after:w-1 after:h-4 after:bg-current after:animate-pulse after:ml-0.5 after:align-middle'
      )}>
        {content}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Write ChatWindow**

Create `components/chat/ChatWindow.tsx`:

```typescript
'use client'

import { useEffect, useRef } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { MessageBubble } from './MessageBubble'
import { useChatStore } from '@/lib/stores/chat'

export function ChatWindow() {
  const { messages, isStreaming, streamingContent } = useChatStore()
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  return (
    <ScrollArea className="flex-1 px-4">
      <div className="space-y-4 py-4">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} role={msg.role} content={msg.content} />
        ))}
        {isStreaming && streamingContent && (
          <MessageBubble role="assistant" content={streamingContent} isStreaming />
        )}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  )
}
```

- [ ] **Step 3: Write ChatInput**

Create `components/chat/ChatInput.tsx`:

```typescript
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useChatStore } from '@/lib/stores/chat'
import { createClient } from '@/lib/supabase/client'
import type { AIMessage, Message } from '@/types'

export function ChatInput() {
  const [input, setInput] = useState('')
  const { currentSessionId, messages, isStreaming, setStreaming,
    appendStreamingContent, clearStreamingContent, setMessages } = useChatStore()

  async function handleSend() {
    const text = input.trim()
    if (!text || !currentSessionId || isStreaming) return
    setInput('')
    setStreaming(true)
    clearStreamingContent()

    const history: AIMessage[] = messages.slice(-10).map(m => ({ role: m.role, content: m.content }))

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, sessionId: currentSessionId, history }),
      })
      if (!res.ok) throw new Error('Chat request failed')

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        for (const line of decoder.decode(value).split('\n')) {
          if (!line.startsWith('data: ')) continue
          const payload = line.slice(6)
          if (payload === '[DONE]') {
            const supabase = createClient()
            const { data } = await supabase.from('messages').select('*')
              .eq('session_id', currentSessionId).order('created_at', { ascending: true })
            if (data) setMessages(data as Message[])
            break
          }
          const { text: chunk } = JSON.parse(payload)
          appendStreamingContent(chunk)
        }
      }
    } catch (err) {
      console.error(err)
    } finally {
      setStreaming(false)
      clearStreamingContent()
    }
  }

  return (
    <div className="border-t p-4">
      <div className="flex gap-2 items-end">
        <Textarea
          placeholder="说点什么..."
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
          rows={1}
          className="resize-none min-h-[44px] max-h-[200px]"
          disabled={isStreaming}
        />
        <Button onClick={handleSend} disabled={!input.trim() || isStreaming || !currentSessionId}>
          发送
        </Button>
      </div>
      <p className="text-xs text-muted-foreground mt-1">Enter 发送，Shift+Enter 换行</p>
    </div>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add components/chat/
git commit -m "feat: chat UI components — MessageBubble, ChatWindow, ChatInput"
```

---

### Task 9: Chat Page and App Layout

**Files:**
- Create: `app/(app)/layout.tsx`
- Create: `app/(app)/chat/page.tsx`
- Modify: `app/layout.tsx`
- Modify: `app/page.tsx`

- [ ] **Step 1: Update root layout**

Replace `app/layout.tsx`:

```typescript
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: '知己',
  description: '你的 AI 自我认知伴侣',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh">
      <body className={inter.className}>{children}</body>
    </html>
  )
}
```

- [ ] **Step 2: Update root page**

Replace `app/page.tsx`:

```typescript
import { redirect } from 'next/navigation'
export default function Home() { redirect('/chat') }
```

- [ ] **Step 3: Write app layout**

Create `app/(app)/layout.tsx`:

```typescript
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return <div className="flex h-screen bg-background">{children}</div>
}
```

- [ ] **Step 4: Write chat page**

Create `app/(app)/chat/page.tsx`:

```typescript
'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ChatWindow } from '@/components/chat/ChatWindow'
import { ChatInput } from '@/components/chat/ChatInput'
import { useChatStore } from '@/lib/stores/chat'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import type { Message, ChatSession } from '@/types'

export default function ChatPage() {
  const { sessions, currentSessionId, setSessions, setCurrentSession, setMessages } = useChatStore()

  useEffect(() => { loadSessions() }, [])

  async function loadSessions() {
    const supabase = createClient()
    const { data } = await supabase.from('chat_sessions').select('*')
      .order('last_message_at', { ascending: false })
    if (data) {
      setSessions(data as ChatSession[])
      if (data.length > 0 && !currentSessionId) selectSession(data[0].id)
    }
  }

  async function selectSession(sessionId: string) {
    setCurrentSession(sessionId)
    const supabase = createClient()
    const { data } = await supabase.from('messages').select('*')
      .eq('session_id', sessionId).order('created_at', { ascending: true })
    if (data) setMessages(data as Message[])
  }

  async function newSession() {
    const supabase = createClient()
    const { data } = await supabase.from('chat_sessions')
      .insert({ title: '新对话' }).select().single()
    if (data) {
      setSessions([data as ChatSession, ...sessions])
      selectSession(data.id)
    }
  }

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  return (
    <>
      <aside className="w-64 border-r flex flex-col">
        <div className="p-4"><h1 className="font-semibold text-lg">知己</h1></div>
        <Separator />
        <div className="p-2">
          <Button variant="outline" className="w-full" onClick={newSession}>+ 新对话</Button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {sessions.map((s) => (
            <button key={s.id} onClick={() => selectSession(s.id)}
              className={`w-full text-left px-3 py-2 rounded-md text-sm truncate transition-colors ${
                s.id === currentSessionId ? 'bg-accent' : 'hover:bg-muted'}`}>
              {s.title ?? '对话'}
            </button>
          ))}
        </div>
        <Separator />
        <div className="p-2">
          <Button variant="ghost" className="w-full text-muted-foreground" onClick={handleSignOut}>
            退出登录
          </Button>
        </div>
      </aside>
      <main className="flex-1 flex flex-col">
        {currentSessionId ? (
          <><ChatWindow /><ChatInput /></>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <p className="text-lg">开始一段新对话</p>
              <Button className="mt-4" onClick={newSession}>新建对话</Button>
            </div>
          </div>
        )}
      </main>
    </>
  )
}
```

- [ ] **Step 5: Run dev server and verify end-to-end**

```bash
npm run dev
```

Open http://localhost:3000. Verify: redirect to /login → register → receive verification email → login → create session → send message → see streaming response → message persisted.

- [ ] **Step 6: Commit**

```bash
git add app/
git commit -m "feat: chat page and app layout — sidebar, session management, sign out"
```

---

## Self-Review

Spec coverage against Phase 1 goals:

- ✅ 项目搭建（Next.js + Supabase + shadcn/ui）— Task 1
- ✅ 认证系统（邮箱注册/登录）— Task 4
- ✅ 基础对话界面（流式输出）— Tasks 6, 8, 9
- ✅ AI 抽象层 + DeepSeek 对接 — Task 5
- ✅ 对话存储（messages + chat_sessions）— Tasks 2, 6
- ✅ 多用户隔离（RLS）— Task 2
- ✅ 模型路由（Flash vs Pro）— Tasks 5, 6

No TBDs or placeholders. `ModelTier`, `AIMessage`, `Message`, `ChatSession` types defined in Task 1 and used consistently. `buildSystemPrompt(scene)` defined in Task 5 prompts and called in Task 6 route. `classifyMessage` returns `{ scene, tier }` in Task 5 router and destructured correctly in Task 6.
