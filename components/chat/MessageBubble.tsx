import type { MessageRole } from '@/types'

interface Props {
  role: MessageRole
  content: string
  isStreaming?: boolean
  timestamp?: string
  emotion_label?: string | null
  emotion_intensity?: number | null
}

export function MessageBubble({ role, content, isStreaming, timestamp, emotion_label, emotion_intensity }: Props) {
  const isUser = role === 'user'

  return (
    <div
      className={`message-row ${isUser ? 'user' : 'ai'}`}
      style={{
        display: 'flex',
        gap: '0.75rem',
        maxWidth: '75%',
        alignSelf: isUser ? 'flex-end' : 'flex-start',
        flexDirection: isUser ? 'row-reverse' : 'row',
      }}
    >
      {!isUser && (
        <div className="ai-avatar">
          <span>知</span>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start' }}>
        <div className={`bubble ${isUser ? 'bubble-user' : 'bubble-ai'}`}>
          {isStreaming && !content ? (
            <div className="typing-dots">
              <span /><span /><span />
            </div>
          ) : (
            <span style={{ whiteSpace: 'pre-wrap' }}>{content}</span>
          )}
          {isStreaming && content && (
            <span
              style={{
                display: 'inline-block',
                width: '2px',
                height: '1em',
                background: 'currentColor',
                marginLeft: '2px',
                verticalAlign: 'middle',
                animation: 'dot-pulse 0.8s ease-in-out infinite',
              }}
            />
          )}
        </div>
        {isUser && emotion_label && !isStreaming && (
          <div className="emotion-chip">
            <span>{emotion_label}</span>
            {emotion_intensity != null && (
              <span className="emotion-chip-pct">{Math.round(emotion_intensity * 100)}%</span>
            )}
          </div>
        )}
        {timestamp && (
          <div
            className="message-time"
            style={{ textAlign: isUser ? 'right' : 'left' }}
          >
            {timestamp}
          </div>
        )}
      </div>
    </div>
  )
}
