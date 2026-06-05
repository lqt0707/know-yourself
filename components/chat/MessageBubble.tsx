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
