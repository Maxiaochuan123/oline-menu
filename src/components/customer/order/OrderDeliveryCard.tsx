'use client'

import { MapPin, Clock, Phone, User, Copy } from 'lucide-react'
import { toast } from 'sonner'

interface OrderDeliveryCardProps {
  scheduledTime: string
  address: string
  customerName: string
  phone: string
}

export default function OrderDeliveryCard({ scheduledTime, address, customerName, phone }: OrderDeliveryCardProps) {
  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text)
    toast.success('已复制到剪贴板')
  }

  return (
    <div className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100 mb-4 animate-in fade-in slide-in-from-bottom duration-700 delay-150">
      <h3 className="text-sm font-black text-slate-900 border-b border-slate-50 pb-4 mb-4 flex items-center justify-between">
        配送信息
        <button 
          onClick={() => handleCopy(address)}
          className="text-[10px] text-slate-400 font-bold bg-slate-50 px-2 py-1 rounded-lg flex items-center gap-1 active:scale-95"
        >
          <Copy size={10} /> 复制地址
        </button>
      </h3>
      
      <div className="space-y-5">
        <div className="flex gap-4">
          <div className="size-9 rounded-2xl bg-orange-50 flex items-center justify-center shrink-0">
            <Clock size={16} className="text-orange-500" />
          </div>
          <div className="flex-1">
            <div className="text-[11px] text-slate-400 font-bold mb-0.5">预定送达时间</div>
            <div className="text-[14px] font-black text-slate-800">
              {new Date(scheduledTime).toLocaleString('zh-CN', { 
                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' 
              })}
            </div>
          </div>
        </div>

        <div className="flex gap-4">
          <div className="size-9 rounded-2xl bg-blue-50 flex items-center justify-center shrink-0">
            <MapPin size={16} className="text-blue-500" />
          </div>
          <div className="flex-1">
            <div className="text-[11px] text-slate-400 font-bold mb-0.5">配送地址</div>
            <div className="text-[14px] font-black text-slate-800 leading-snug mb-1">{address}</div>
            <div className="flex items-center gap-2 text-[12px] text-slate-500 font-bold">
              <User size={12} /> {customerName}
              <span className="w-1 h-1 bg-slate-300 rounded-full" />
              <Phone size={12} /> {phone}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
