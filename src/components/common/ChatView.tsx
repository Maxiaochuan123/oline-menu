'use client'

import { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { Send } from 'lucide-react'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { MessageBubble } from '@/components/common/MessageBubble'
import type { Message } from '@/lib/types'

interface ChatViewProps {
  messages: Message[]
  currentUserRole: 'merchant' | 'customer'
  value: string
  onChange: (value: string) => void
  onSend: () => void
  sending?: boolean
  placeholder?: string
  scrollAreaClassName?: string
  autoScroll?: boolean
  showInput?: boolean
  emptyState?: ReactNode
  inputTopContent?: ReactNode
  scrollContainerRef?: RefObject<HTMLElement | null>
}

export function ChatView({
  messages,
  currentUserRole,
  value,
  onChange,
  onSend,
  sending = false,
  placeholder = '发送消息...',
  scrollAreaClassName = 'h-[240px]',
  autoScroll = true,
  showInput = true,
  emptyState,
  inputTopContent,
  scrollContainerRef,
}: ChatViewProps) {
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const composerRef = useRef<HTMLDivElement>(null)
  const lastTextareaHeightRef = useRef(0)
  const previousMessageCountRef = useRef(messages.length)
  const hasMountedRef = useRef(false)
  const hasHydratedHistoryRef = useRef(messages.length > 0)

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return

    textarea.style.height = 'auto'

    const computedStyle = window.getComputedStyle(textarea)
    const lineHeight = Number.parseFloat(computedStyle.lineHeight) || 20
    const paddingTop = Number.parseFloat(computedStyle.paddingTop) || 0
    const paddingBottom = Number.parseFloat(computedStyle.paddingBottom) || 0
    const borderTop = Number.parseFloat(computedStyle.borderTopWidth) || 0
    const borderBottom = Number.parseFloat(computedStyle.borderBottomWidth) || 0
    const maxHeight = lineHeight * 3 + paddingTop + paddingBottom + borderTop + borderBottom
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight)

    textarea.style.height = `${nextHeight}px`
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden'

    if (document.activeElement === textarea && nextHeight !== lastTextareaHeightRef.current) {
      requestAnimationFrame(() => {
        composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      })
    }

    lastTextareaHeightRef.current = nextHeight
  }, [value, scrollContainerRef])

  function scrollMessagesToBottom(behavior: ScrollBehavior = 'smooth') {
    messagesContainerRef.current?.scrollTo({
      top: messagesContainerRef.current.scrollHeight,
      behavior,
    })
  }

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true
      previousMessageCountRef.current = messages.length
      if (autoScroll && messages.length > 0) {
        requestAnimationFrame(() => {
          scrollMessagesToBottom('auto')
        })
      }
      return
    }

    if (!hasHydratedHistoryRef.current && previousMessageCountRef.current === 0 && messages.length > 0) {
      previousMessageCountRef.current = messages.length
      hasHydratedHistoryRef.current = true
      if (autoScroll) {
        requestAnimationFrame(() => {
          scrollMessagesToBottom('auto')
        })
      }
      return
    }

    const hasNewMessage = messages.length > previousMessageCountRef.current

    if (autoScroll && hasNewMessage) {
      scrollMessagesToBottom('smooth')
      if (scrollContainerRef?.current) {
        scrollContainerRef.current.scrollTo({
          top: scrollContainerRef.current.scrollHeight,
          behavior: 'smooth',
        })
      }
    }

    previousMessageCountRef.current = messages.length
    if (messages.length > 0) {
      hasHydratedHistoryRef.current = true
    }
  }, [messages, autoScroll, scrollContainerRef])

  function scrollComposerIntoView() {
    requestAnimationFrame(() => {
      composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    })
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSend()
      scrollComposerIntoView()
    }
  }

  return (
    <div className="flex flex-col overflow-hidden">
      <div ref={messagesContainerRef} className={`overflow-y-auto px-4 py-3 custom-scrollbar ${scrollAreaClassName}`}>
        {messages.length === 0 ? (
          emptyState ?? (
            <div className="flex items-center justify-center h-full py-8 text-xs font-medium text-slate-400">
              暂无沟通记录
            </div>
          )
        ) : (
          messages.map((msg, idx) => {
            const prevMsg = idx > 0 ? messages[idx - 1] : null
            const showTime =
              !prevMsg ||
              new Date(msg.created_at).getTime() - new Date(prevMsg.created_at).getTime() > 5 * 60 * 1000

            return (
              <MessageBubble
                key={msg.id}
                msg={msg}
                currentUserRole={currentUserRole}
                showTime={showTime}
              />
            )
          })
        )}
        <div ref={endRef} />
      </div>

      {showInput && (
        <div ref={composerRef} className="border-t bg-slate-50 p-3">
          {inputTopContent ? <div className="mb-3">{inputTopContent}</div> : null}
          <div className="flex items-end gap-2">
            <Textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={placeholder}
              rows={1}
              className="min-h-[40px] flex-1 resize-none overflow-y-auto rounded-2xl border-slate-200 bg-white px-4 py-2.5 text-sm font-medium leading-relaxed transition-all focus-visible:ring-orange-500 [field-sizing:fixed] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
              onKeyDown={handleKeyDown}
              onFocus={scrollComposerIntoView}
            />
            <Button
              onClick={() => {
                onSend()
                scrollComposerIntoView()
              }}
              disabled={sending || !value.trim()}
              className="size-10 shrink-0 rounded-full bg-orange-500 p-0 shadow-md shadow-orange-200 hover:bg-orange-600 disabled:opacity-50"
            >
              {sending ? (
                <div className="spinner size-4 border-2 border-white/30 border-t-white" />
              ) : (
                <Send size={16} />
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
