'use client'

import { Info } from 'lucide-react'
import { useState } from 'react'

export default function WechatGuide() {
  const [copied, setCopied] = useState(false)

  const copyLink = () => {
    const text = window.location.href
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).catch(() => fallbackCopy(text))
    } else {
      fallbackCopy(text)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const fallbackCopy = (text: string) => {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.left = '-999999px'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    try { document.execCommand('copy') } catch { /* ignore */ }
    document.body.removeChild(ta)
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'white', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', padding: '32px',
      textAlign: 'center'
    }}>
      <div style={{ 
        width: '80px', height: '80px', background: '#f0fdf4', 
        borderRadius: '50%', display: 'flex', alignItems: 'center', 
        justifyContent: 'center', marginBottom: '24px'
      }}>
        <Info size={40} color="#22c55e" />
      </div>

      <h2 style={{ fontSize: '22px', fontWeight: '800', marginBottom: '12px' }}>需要用浏览器打开</h2>
      <p style={{ color: '#666', lineHeight: '1.6', marginBottom: '32px' }}>
        为了确保支付和下单流程的顺畅体验，请点击右上角 <span style={{ fontWeight: '700' }}>···</span> 并选择 <span style={{ fontWeight: '700', color: '#f97316' }}>“在浏览器打开”</span>。
      </p>

      <div style={{ 
        width: '100%', background: '#f9fafb', borderRadius: '16px', 
        padding: '20px', border: '1px dashed #d1d5db'
      }}>
        <p style={{ fontSize: '13px', color: '#999', marginBottom: '10px' }}>也可以复制链接到浏览器访问</p>
        <div style={{ 
          display: 'flex', background: 'white', padding: '12px', 
          borderRadius: '10px', border: '1px solid #e5e7eb', gap: '8px',
          alignItems: 'center'
        }}>
          <span style={{ 
            flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', 
            whiteSpace: 'nowrap', fontSize: '14px', textAlign: 'left'
          }}>
            {typeof window !== 'undefined' ? window.location.href : ''}
          </span>
          <button 
            onClick={copyLink}
            style={{ 
              background: copied ? '#22c55e' : '#f97316', color: 'white',
              border: 'none', borderRadius: '6px', padding: '6px 12px',
              fontSize: '12px', fontWeight: '600', cursor: 'pointer'
            }}
          >
            {copied ? '已复制' : '复制'}
          </button>
        </div>
      </div>
    </div>
  )
}
