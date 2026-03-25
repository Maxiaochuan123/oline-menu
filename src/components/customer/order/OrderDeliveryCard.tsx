import { MapPin, Clock, Phone, User } from 'lucide-react'
import CopyButton from '@/components/common/CopyButton'

interface OrderDeliveryCardProps {
  scheduledTime: string
  address: string
  customerName: string
  phone: string
}

export default function OrderDeliveryCard({ scheduledTime, address, customerName, phone }: OrderDeliveryCardProps) {
  return (
    <div className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100 mb-4 animate-in fade-in slide-in-from-bottom duration-700 delay-150">
      <h3 className="text-sm font-black text-slate-900 border-b border-slate-50 pb-4 mb-4 flex items-center justify-between uppercase tracking-tight">
        配送信息
        <CopyButton 
          text={address} 
          initialLabel="复制地址" 
          className="shadow-none ring-0 h-7" 
        />
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
