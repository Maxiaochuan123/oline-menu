'use client'

import React, { useState, useEffect, useRef } from 'react'
import { MessageSquare, Send, Star } from 'lucide-react'
import { MessageBubble } from '@/components/common/MessageBubble'
import type { Message } from '@/lib/types'

interface OrderChatBoxProps {
  messages: Message[]
  onSendMessage: (text: string, rating?: number) => void
  onQuickRating: (score: number) => void
  shouldShowRatingPanel: boolean
  sendingMsg: boolean
}

export default function OrderChatBox({ 
  messages, 
  onSendMessage, 
  onQuickRating, 
  shouldShowRatingPanel,
  sendingMsg 
}: OrderChatBoxProps) {
  const [msgText, setMsgText] = useState('')
  const [rating, setRating] = useState(0)
  const msgBoxRef = useRef<HTMLDivElement>(null)
  const isInitialLoad = useRef(true)

  useEffect(() => {
    if (msgBoxRef.current) {
      msgBoxRef.current.scrollTop = msgBoxRef.current.scrollHeight
    }
  }, [messages])

  const handleSend = () => {
    if (!msgText.trim() && rating === 0) return
    onSendMessage(msgText, rating || undefined)
    setMsgText('')
    setRating(0)
  }

  return (
    <div className="bg-white rounded-3xl overflow-hidden shadow-sm border border-slate-100 mb-4">
      <div className="px-5 py-4 border-b border-slate-50 flex items-center gap-2">
        <div className="size-8 rounded-xl bg-indigo-50 flex items-center justify-center">
          <MessageSquare size={16} className="text-indigo-500" />
        </div>
        <span className="font-black text-slate-800 text-[15px]">客服与评价</span>
      </div>

      <div 
        ref={msgBoxRef}
        className="px-4 py-4 min-h-[120px] max-h-[420px] overflow-y-auto bg-slate-50/30 custom-scrollbar flex flex-col gap-4"
      >
        {messages.length === 0 ? (
          <div className="py-10 flex flex-col items-center justify-center text-slate-400">
            <MessageSquare size={40} className="opacity-10 mb-2" />
            <p className="text-[12px] font-bold">暂无沟通记录，如有问题可留言</p>
          </div>
        ) : messages.map((msg, idx) => {
          const prevMsg = idx > 0 ? messages[idx - 1] : null
          const showTime = !prevMsg || (new Date(msg.created_at).getTime() - new Date(prevMsg.created_at).getTime() > 5 * 60 * 1000)
          return <MessageBubble key={msg.id} msg={msg} currentUserRole="customer" showTime={showTime} />
        })}
      </div>

      <div className="p-4 bg-white border-t border-slate-50">
        {shouldShowRatingPanel && (
          <div className="bg-amber-50 rounded-2xl p-4 mb-4 animate-in slide-in-from-bottom">
            <div className="text-[12px] text-amber-700 font-black mb-3 text-center">本次服务还满意吗？请评价：</div>
            <div className="flex justify-center gap-3">
              {[1, 2, 3, 4, 5].map(s => (
                <button 
                  key={s} 
                  onClick={() => onQuickRating(s)}
                  className="transition-transform active:scale-125"
                >
                  <Star 
                    size={28} 
                    fill={(rating || 0) >= s ? '#f59e0b' : 'none'} 
                    color={(rating || 0) >= s ? '#f59e0b' : '#d1d5db'} 
                  />
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-2 items-end">
          <textarea
            value={msgText}
            onChange={e => setMsgText(e.target.value)}
            placeholder="给商家留言..."
            rows={1}
            className="flex-1 bg-slate-100/50 border-transparent focus:bg-white focus:border-slate-200 focus:ring-0 rounded-2xl px-4 py-3 text-sm transition-all resize-none max-h-32"
          />
          <button
            onClick={handleSend}
            disabled={sendingMsg || (!msgText.trim() && rating === 0)}
            className="size-11 rounded-2xl bg-slate-900 flex items-center justify-center text-white active:scale-90 transition-transform disabled:opacity-30 shadow-lg shadow-slate-200"
          >
            <Send size={18} />
          </button>
        </div>
      </div>
    </div>
  )
}
