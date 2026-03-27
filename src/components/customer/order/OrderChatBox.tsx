'use client'

import { useState, type RefObject } from 'react'
import { MessageSquare, Star } from 'lucide-react'
import { ChatView } from '@/components/common/ChatView'
import type { Message } from '@/lib/types'

interface OrderChatBoxProps {
  messages: Message[]
  onSendMessage: (text: string, rating?: number) => void
  onQuickRating: (score: number) => void
  shouldShowRatingPanel: boolean
  sendingMsg: boolean
  scrollContainerRef?: RefObject<HTMLElement | null>
}

export default function OrderChatBox({
  messages,
  onSendMessage,
  onQuickRating,
  shouldShowRatingPanel,
  sendingMsg,
  scrollContainerRef,
}: OrderChatBoxProps) {
  const [msgText, setMsgText] = useState('')

  function handleSend() {
    if (!msgText.trim()) return
    onSendMessage(msgText)
    setMsgText('')
  }

  const ratingPanel = shouldShowRatingPanel ? (
    <div className="animate-in slide-in-from-bottom rounded-2xl bg-amber-50 p-4">
      <div className="mb-3 text-center text-[12px] font-black text-amber-700">本次服务还满意吗？请评价</div>
      <div className="flex justify-center gap-3">
        {[1, 2, 3, 4, 5].map((score) => (
          <button
            key={score}
            onClick={() => onQuickRating(score)}
            className="transition-transform active:scale-125"
          >
            <Star
              size={28}
              fill="none"
              color="#d1d5db"
            />
          </button>
        ))}
      </div>
    </div>
  ) : null

  return (
    <div className="mb-4 overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-50 px-5 py-4">
        <div className="flex size-8 items-center justify-center rounded-xl bg-indigo-50">
          <MessageSquare size={16} className="text-indigo-500" />
        </div>
        <span className="text-[15px] font-black text-slate-800">客服与评价</span>
      </div>

      <ChatView
        messages={messages}
        currentUserRole="customer"
        value={msgText}
        onChange={setMsgText}
        onSend={handleSend}
        sending={sendingMsg}
        placeholder="给商家留言..."
        scrollAreaClassName="min-h-[120px] max-h-[420px] bg-slate-50/30"
        scrollContainerRef={scrollContainerRef}
        emptyState={
          <div className="flex flex-col items-center justify-center py-10 text-slate-400">
            <MessageSquare size={40} className="mb-2 opacity-10" />
            <p className="text-[12px] font-bold">暂无沟通记录，如有问题可留言</p>
          </div>
        }
        inputTopContent={ratingPanel}
      />
    </div>
  )
}
