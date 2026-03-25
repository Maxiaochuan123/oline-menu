import { Gift } from 'lucide-react'
import { useDraggableSticky } from '@/hooks/useDraggableSticky'

interface DraggableCouponButtonProps {
  count: number
  onClick: () => void
  bottomOffset?: number
}

export default function DraggableCouponButton({ count, onClick, bottomOffset = 20 }: DraggableCouponButtonProps) {
  const { dragRef, dragX, position, isDragging, handlers } = useDraggableSticky({
    initialY: 180 + bottomOffset,
    margin: 16,
    buttonWidth: 48
  })

  return (
    <div
      ref={dragRef}
      {...handlers}
      onClick={() => !isDragging && onClick()}
      style={{
        left: `${dragX}px`,
        top: `${position.y}px`,
        transition: isDragging ? 'none' : 'all 0.5s cubic-bezier(0.19, 1, 0.22, 1)',
      }}
      className="fixed z-[100] w-12 h-12 rounded-full bg-gradient-to-br from-[#ffedd5] to-[#fff7ed] shadow-[0_8px_20px_rgba(234,88,12,0.3)] flex flex-col items-center justify-center cursor-pointer border-[2.5px] border-[#ea580c] touch-none pulsing-coupon-btn"
    >
      <Gift size={20} className="text-[#ea580c] mb-[-2px] animate-gift-shake" />
      <span className="text-[10px] font-black text-[#ea580c]">抢券</span>
      
      <div className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-black w-5 h-5 rounded-full flex items-center justify-center border-2 border-white">
        {count}
      </div>
    </div>
  )
}
