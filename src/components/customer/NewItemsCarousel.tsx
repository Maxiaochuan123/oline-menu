'use client'

/* eslint-disable @next/next/no-img-element */

import { useState, useEffect } from 'react'
import type { MenuItem } from '@/lib/types'
import { formatPrice } from '@/lib/utils'
import { X, ShoppingCart, Sparkles } from 'lucide-react'

interface Props {
  items: MenuItem[]
  onAdd: (item: MenuItem) => void
}

export default function NewItemsCarousel({ items, onAdd }: Props) {
  const [open, setOpen] = useState(false)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [countdown, setCountdown] = useState(10)

  useEffect(() => {
    if (items.length === 0) return

    // 用 sessionStorage：每次打开/刷新页面都会弹，而不是每天只弹一次
    const merchantId = items[0].merchant_id
    const storageKey = `new_items_popup_${merchantId}`

    if (sessionStorage.getItem(storageKey) !== 'shown') {
      // 延迟 800ms 弹出，让页面先加载完
      const t = setTimeout(() => {
        setCountdown(10)
        setOpen(true)
        sessionStorage.setItem(storageKey, 'shown')
      }, 800)
      return () => clearTimeout(t)
    }
  }, [items])


  useEffect(() => {
    if (!open) return
    if (countdown <= 0) { setOpen(false); return }
    const timer = setInterval(() => setCountdown(c => c - 1), 1000)
    return () => clearInterval(timer)
  }, [open, countdown])

  // 多品自动轮播
  useEffect(() => {
    if (!open || items.length <= 1) return
    const timer = setInterval(() => {
      setCurrentIndex(prev => (prev + 1) % items.length)
    }, 3000)
    return () => clearInterval(timer)
  }, [open, items.length])

  if (!open || items.length === 0) return null

  const item = items[currentIndex]

  return (
    <>
      <div className="overlay" style={{ zIndex: 100 }} onClick={() => setOpen(false)} />
      <div className="dialog animate-fade-in" style={{ zIndex: 110, padding: 0, overflow: 'hidden', maxWidth: '340px' }}>
        {/* 关闭按钮 */}
        <button
          onClick={() => setOpen(false)}
          style={{
            position: 'absolute', top: 12, right: 12, zIndex: 10,
            background: 'rgba(0,0,0,0.45)', border: 'none', borderRadius: '50%',
            width: 30, height: 30, color: 'white',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <X size={18} />
        </button>

        {/* 图片区 */}
        <div style={{ position: 'relative', width: '100%', aspectRatio: '4/3' }}>
          {item.image_url
            ? <img src={item.image_url} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : (
              <div style={{
                width: '100%', height: '100%',
                background: 'linear-gradient(135deg, #f97316 0%, #ef4444 100%)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Sparkles size={64} color="rgba(255,255,255,0.6)" />
              </div>
            )
          }
          {/* 新品角标 */}
          <div style={{
            position: 'absolute', bottom: 12, left: 12,
            background: 'var(--color-primary)', color: 'white',
            padding: '4px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: '800',
            boxShadow: '0 2px 8px rgba(249,115,22,0.5)',
          }}>
            ✨ 新品上架
          </div>
          {/* 多品指示器 */}
          {items.length > 1 && (
            <div style={{
              position: 'absolute', bottom: 12, right: 12,
              display: 'flex', gap: '4px',
            }}>
              {items.map((_, i) => (
                <div
                  key={i}
                  onClick={() => setCurrentIndex(i)}
                  style={{
                    width: i === currentIndex ? 16 : 6, height: 6,
                    borderRadius: 3, cursor: 'pointer',
                    background: i === currentIndex ? 'white' : 'rgba(255,255,255,0.5)',
                    transition: 'width 0.3s',
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* 内容区 */}
        <div style={{ padding: '18px 20px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h3 style={{ fontSize: '18px', fontWeight: '800', marginBottom: '4px' }}>{item.name}</h3>
              <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)', lineHeight: '1.5',
                overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                {item.description || '店铺招牌新品，快来品尝吧 🍽️'}
              </p>
            </div>
            <div style={{ fontSize: '22px', fontWeight: '800', color: 'var(--color-primary)', flexShrink: 0 }}>
              {formatPrice(item.price)}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
            <button
              className="btn btn-outline"
              style={{ flex: 1, fontSize: '14px' }}
              onClick={() => setOpen(false)}
            >
              再看看（{countdown}s）
            </button>
            <button
              className="btn btn-primary"
              style={{ flex: 1, fontSize: '14px' }}
              onClick={() => { onAdd(item); setOpen(false) }}
            >
              <ShoppingCart size={15} /> 立即加购
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
