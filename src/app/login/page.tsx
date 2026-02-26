'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { UtensilsCrossed } from 'lucide-react'

export default function LoginPage() {
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [isRegister, setIsRegister] = useState(false)
  const [shopName, setShopName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()
  const supabase = createClient()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    // 将手机号转为虚拟邮箱以绕过短信费用
    const virtualEmail = `${phone}@merchant.app`

    try {
      if (isRegister) {
        // 注册
        const { data: authData, error: authError } = await supabase.auth.signUp({
          email: virtualEmail,
          password,
        })
        if (authError) throw authError

        // 创建商家记录
        if (authData.user) {
          const { error: merchantError } = await supabase.from('merchants').insert({
            user_id: authData.user.id,
            email: phone, // 在业务表中存真实手机号
            shop_name: shopName || '我的小店',
          })
          if (merchantError) throw merchantError
        }
      } else {
        // 登录
        const { error: authError } = await supabase.auth.signInWithPassword({
          email: virtualEmail,
          password,
        })
        if (authError) throw authError
      }

      router.push('/dashboard')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '操作失败'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #fff7ed 0%, #ffedd5 50%, #fed7aa 100%)',
      padding: '16px',
    }}>
      <div style={{
        width: '100%',
        maxWidth: '400px',
        background: 'white',
        borderRadius: '20px',
        padding: '40px 32px',
        boxShadow: '0 20px 60px rgba(249, 115, 22, 0.12)',
      }}
      className="animate-slide-up"
      >
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{
            width: '64px',
            height: '64px',
            background: 'linear-gradient(135deg, #f97316, #ea580c)',
            borderRadius: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px',
          }}>
            <UtensilsCrossed size={32} color="white" />
          </div>
          <h1 style={{ fontSize: '24px', fontWeight: '700', color: '#1c1917' }}>
            在线点餐系统
          </h1>
          <p style={{ color: '#78716c', fontSize: '14px', marginTop: '4px' }}>
            {isRegister ? '创建商家账号' : '商家登录'}
          </p>
        </div>

        {/* 表单 */}
        <form onSubmit={handleSubmit}>
          {isRegister && (
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '6px', color: '#44403c' }}>
                店铺名称
              </label>
              <input
                className="input"
                type="text"
                placeholder="例：王姐家常菜"
                value={shopName}
                onChange={(e) => setShopName(e.target.value)}
                required
              />
            </div>
          )}

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '6px', color: '#44403c' }}>
              手机号
            </label>
            <input
              className="input"
              type="tel"
              placeholder="请输入手机号"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
              pattern="[0-9]{11}"
            />
          </div>

          <div style={{ marginBottom: '24px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '6px', color: '#44403c' }}>
              密码
            </label>
            <input
              className="input"
              type="password"
              placeholder="至少 6 位"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </div>

          {error && (
            <div style={{
              background: '#fef2f2',
              color: '#dc2626',
              padding: '10px 14px',
              borderRadius: '10px',
              fontSize: '13px',
              marginBottom: '16px',
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary btn-block"
            disabled={loading}
            style={{ height: '44px', fontSize: '15px' }}
          >
            {loading ? <span className="spinner" /> : (isRegister ? '注册' : '登录')}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: '20px' }}>
          <button
            onClick={() => { setIsRegister(!isRegister); setError('') }}
            style={{
              background: 'none',
              border: 'none',
              color: '#f97316',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: '500',
            }}
          >
            {isRegister ? '已有账号？去登录' : '没有账号？注册'}
          </button>
        </div>
      </div>
    </div>
  )
}
