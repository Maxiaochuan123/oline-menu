'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import type { Merchant, Category, MenuItem } from '@/lib/types'
import { formatPrice } from '@/lib/utils'
import {
  ArrowLeft, Plus, Pencil, Trash2, X, Upload,
  FolderOpen, Sparkles, Eye, EyeOff, UtensilsCrossed
} from 'lucide-react'
import Link from 'next/link'

export default function MenuPage() {
  const supabase = createClient()
  const router = useRouter()
  const [merchant, setMerchant] = useState<Merchant | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // 弹窗状态
  const [showCategoryForm, setShowCategoryForm] = useState(false)
  const [showItemForm, setShowItemForm] = useState(false)
  const [editingCategory, setEditingCategory] = useState<Category | null>(null)
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null)

  // 表单
  const [catName, setCatName] = useState('')
  const [itemName, setItemName] = useState('')
  const [itemDesc, setItemDesc] = useState('')
  const [itemPrice, setItemPrice] = useState('')
  const [itemCatId, setItemCatId] = useState('')
  const [itemIsNew, setItemIsNew] = useState(true)
  const [itemNewUntil, setItemNewUntil] = useState('')
  const [itemImage, setItemImage] = useState<File | null>(null)
  const [itemImagePreview, setItemImagePreview] = useState<string | null>(null)
  const [itemUnit, setItemUnit] = useState('个')
  const [saving, setSaving] = useState(false)

  const loadData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const { data: m } = await supabase.from('merchants').select('*').eq('user_id', user.id).single()
    if (!m) { router.push('/login'); return }
    setMerchant(m)

    const { data: cats } = await supabase.from('categories').select('*').eq('merchant_id', m.id).order('sort_order')
    setCategories(cats || [])
    if (cats && cats.length > 0 && !activeCategory) setActiveCategory(cats[0].id)

    const { data: items } = await supabase.from('menu_items').select('*').eq('merchant_id', m.id).order('created_at', { ascending: false })
    setMenuItems(items || [])
    setLoading(false)
  }, [supabase, router, activeCategory])

  useEffect(() => { loadData() }, [loadData])

  // ---- 分类操作 ----
  async function saveCategory() {
    if (!merchant || !catName.trim()) return
    setSaving(true)
    if (editingCategory) {
      await supabase.from('categories').update({ name: catName.trim() }).eq('id', editingCategory.id)
    } else {
      await supabase.from('categories').insert({ merchant_id: merchant.id, name: catName.trim(), sort_order: categories.length })
    }
    setCatName('')
    setEditingCategory(null)
    setShowCategoryForm(false)
    setSaving(false)
    loadData()
  }

  async function deleteCategory(id: string) {
    if (!confirm('删除分类将移除该分类下所有菜品的分类关联，确定吗？')) return
    await supabase.from('categories').delete().eq('id', id)
    loadData()
  }

  // ---- 菜品操作 ----
  function openItemForm(item?: MenuItem) {
    if (item) {
      setEditingItem(item)
      setItemName(item.name)
      setItemDesc(item.description || '')
      setItemPrice(String(item.price))
      setItemUnit(item.unit || '个')
      setItemCatId(item.category_id || '')
      setItemIsNew(item.is_new)
      setItemNewUntil(item.new_until ? item.new_until.slice(0, 10) : '')
      setItemImagePreview(item.image_url || null)
    } else {
      setEditingItem(null)
      setItemName('')
      setItemDesc('')
      setItemPrice('')
      setItemUnit('个')
      setItemCatId(activeCategory || '')
      setItemIsNew(true)
      const date = new Date()
      date.setDate(date.getDate() + 7)
      setItemNewUntil(date.toISOString().slice(0, 10))
      setItemImagePreview(null)
    }
    setItemImage(null)
    setShowItemForm(true)
  }

  async function saveItem() {
    if (!merchant || !itemName.trim() || !itemPrice) return
    setSaving(true)

    let imageUrl = editingItem?.image_url || null
    if (itemImage) {
      const ext = itemImage.name.split('.').pop() || 'jpg'
      const fileName = `${merchant.id}/${Date.now()}.${ext}`
      const { data: uploadData } = await supabase.storage.from('menu-images').upload(fileName, itemImage)
      if (uploadData) {
        const { data: urlData } = supabase.storage.from('menu-images').getPublicUrl(uploadData.path)
        imageUrl = urlData.publicUrl
      }
    }

    const newUntil = itemNewUntil ? new Date(itemNewUntil).toISOString() : (itemIsNew ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() : null)

    const payload = {
      merchant_id: merchant.id,
      category_id: itemCatId || null,
      name: itemName.trim(),
      description: itemDesc.trim() || null,
      price: parseFloat(itemPrice),
      unit: itemUnit,
      image_url: imageUrl,
      is_new: itemIsNew,
      new_until: newUntil,
    }

    if (editingItem) {
      await supabase.from('menu_items').update(payload).eq('id', editingItem.id)
    } else {
      await supabase.from('menu_items').insert(payload)
    }

    setShowItemForm(false)
    setSaving(false)
    loadData()
  }

  async function toggleItemAvailable(item: MenuItem) {
    await supabase.from('menu_items').update({ is_available: !item.is_available }).eq('id', item.id)
    loadData()
  }

  async function deleteItem(id: string) {
    // 检查是否有历史订单引用了这道菜品
    const { count } = await supabase
      .from('order_items')
      .select('id', { count: 'exact', head: true })
      .eq('menu_item_id', id)

    if ((count ?? 0) > 0) {
      // 有历史订单引用 → 只能软删除（下架隐藏）
      if (!confirm(`该菜品已有 ${count} 条历史订单记录，无法彻底删除。\n是否将其下架隐藏？（历史订单数据不受影响）`)) return
      await supabase.from('menu_items').update({ is_available: false }).eq('id', id)
    } else {
      // 从未被下单 → 可以物理删除
      if (!confirm('确定要彻底删除这道菜品？此操作不可恢复。')) return
      await supabase.from('menu_items').delete().eq('id', id)
    }
    loadData()
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <span className="spinner" />
      </div>
    )
  }

  const filteredItems = activeCategory
    ? menuItems.filter(i => i.category_id === activeCategory)
    : menuItems

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)' }}>
      {/* 顶部 */}
      <header style={{
        background: 'white', padding: '14px 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid var(--color-border)', position: 'sticky', top: 0, zIndex: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Link href="/dashboard"><ArrowLeft size={22} color="#1c1917" /></Link>
          <span style={{ fontWeight: '700', fontSize: '17px' }}>菜单管理</span>
        </div>
        <button onClick={() => openItemForm()} className="btn btn-primary btn-sm">
          <Plus size={14} /> 添加菜品
        </button>
      </header>

      {/* 分类管理 */}
      <div style={{ padding: '12px 20px', background: 'white', borderBottom: '1px solid var(--color-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
          <span style={{ fontWeight: '600', fontSize: '14px' }}>分类</span>
          <button onClick={() => { setCatName(''); setEditingCategory(null); setShowCategoryForm(true) }}
            style={{ background: 'none', border: 'none', color: '#f97316', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>
            <Plus size={14} style={{ verticalAlign: 'middle' }} /> 添加分类
          </button>
        </div>
        <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '4px' }}>
          <button
            onClick={() => setActiveCategory(null)}
            className={`btn btn-sm ${!activeCategory ? 'btn-primary' : 'btn-outline'}`}
          >
            全部
          </button>
          {categories.map(cat => (
            <div key={cat.id} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '2px' }}>
              <button
                onClick={() => setActiveCategory(cat.id)}
                className={`btn btn-sm ${activeCategory === cat.id ? 'btn-primary' : 'btn-outline'}`}
              >
                {cat.name}
              </button>
              <button onClick={() => { setEditingCategory(cat); setCatName(cat.name); setShowCategoryForm(true) }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px' }}>
                <Pencil size={12} color="#78716c" />
              </button>
              <button onClick={() => deleteCategory(cat.id)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px' }}>
                <Trash2 size={12} color="#ef4444" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* 菜品列表 */}
      <div style={{ padding: '16px 20px 100px' }}>
        {filteredItems.length === 0 ? (
          <div className="empty-state">
            <FolderOpen />
            <p>暂无菜品</p>
            <p style={{ fontSize: '13px', marginTop: '4px' }}>点击右上角添加你的第一道菜品</p>
          </div>
        ) : (
          filteredItems.map(item => (
            <div key={item.id} className="card animate-fade-in" style={{
              marginBottom: '10px', display: 'flex', gap: '12px',
              opacity: item.is_available ? 1 : 0.5,
            }}>
              {/* 图片 */}
              <div style={{
                width: '80px', height: '80px', borderRadius: '10px',
                background: '#f5f5f4',
                flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                overflow: 'hidden',
              }}>
                {item.image_url
                  ? <img src={item.image_url} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <UtensilsCrossed size={24} color="#d6d3d1" />}
              </div>
              {/* 信息 */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontWeight: '600', fontSize: '15px' }}>{item.name}</span>
                  {item.is_new && new Date(item.new_until || '') > new Date() && (
                    <span className="tag tag-new"><Sparkles size={10} /> 新</span>
                  )}
                  {!item.is_available && <span className="tag" style={{ background: '#f5f5f4', color: '#a8a29e' }}>已下架</span>}
                </div>
                {item.description && (
                  <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.description}
                  </div>
                )}
                <div style={{ fontSize: '16px', fontWeight: '700', color: '#f97316', marginTop: '6px' }}>
                  {formatPrice(item.price)}<span style={{ fontSize: '12px', color: '#a8a29e', fontWeight: '400' }}>/{item.unit || '个'}</span>
                </div>
              </div>
              {/* 操作 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'center', justifyContent: 'center' }}>
                <button onClick={() => toggleItemAvailable(item)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
                  {item.is_available ? <Eye size={16} color="#22c55e" /> : <EyeOff size={16} color="#a8a29e" />}
                </button>
                <button onClick={() => openItemForm(item)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
                  <Pencil size={16} color="#3b82f6" />
                </button>
                <button onClick={() => deleteItem(item.id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
                  <Trash2 size={16} color="#ef4444" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* 分类表单弹窗 */}
      {showCategoryForm && (
        <>
          <div className="overlay" onClick={() => setShowCategoryForm(false)} />
          <div className="dialog">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ fontWeight: '700' }}>{editingCategory ? '编辑分类' : '添加分类'}</h3>
              <button onClick={() => setShowCategoryForm(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>
            <input className="input" placeholder="分类名称" value={catName} onChange={e => setCatName(e.target.value)} />
            <button onClick={saveCategory} className="btn btn-primary btn-block" disabled={saving} style={{ marginTop: '16px' }}>
              {saving ? <span className="spinner" /> : '保存'}
            </button>
          </div>
        </>
      )}

      {/* 菜品表单弹窗 */}
      {showItemForm && (
        <>
          <div className="overlay" onClick={() => setShowItemForm(false)} />
          <div className="dialog">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ fontWeight: '700' }}>{editingItem ? '编辑菜品' : '添加菜品'}</h3>
              <button onClick={() => setShowItemForm(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <input className="input" placeholder="菜品名称 *" value={itemName} onChange={e => setItemName(e.target.value)} />
              <input className="input" placeholder="描述（可选）" value={itemDesc} onChange={e => setItemDesc(e.target.value)} />
              {/* 价格 + 单位 */}
              <div style={{ display: 'flex', gap: '8px' }}>
                <input className="input" type="number" step="0.01" placeholder="价格 *" value={itemPrice} onChange={e => setItemPrice(e.target.value)} style={{ flex: 1 }} />
                <select className="input" value={itemUnit} onChange={e => setItemUnit(e.target.value)} style={{ width: '90px' }}>
                  <option value="个">/ 个</option>
                  <option value="斤">/ 斤</option>
                  <option value="份">/ 份</option>
                  <option value="碗">/ 碗</option>
                  <option value="杯">/ 杯</option>
                  <option value="盒">/ 盒</option>
                  <option value="袋">/ 袋</option>
                </select>
              </div>
              <select className="input" value={itemCatId} onChange={e => setItemCatId(e.target.value)}>
                <option value="">选择分类（可选）</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input type="checkbox" id="isNew" checked={itemIsNew} onChange={e => setItemIsNew(e.target.checked)} />
                <label htmlFor="isNew" style={{ fontSize: '14px' }}>标记为新品</label>
              </div>
              {itemIsNew && (
                <div>
                  <label style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>新品标签截止日期</label>
                  <input className="input" type="date" value={itemNewUntil} onChange={e => setItemNewUntil(e.target.value)} style={{ marginTop: '4px' }} />
                </div>
              )}
              {/* 图片上传 + 本地预览 */}
              <div>
                <label style={{ fontSize: '13px', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '8px' }}>
                  <Upload size={14} /> 菜品图片
                </label>
                {itemImagePreview && (
                  <img src={itemImagePreview} alt="预览" style={{ width: '100%', height: '160px', objectFit: 'cover', borderRadius: '10px', marginBottom: '8px', border: '1px solid var(--color-border)' }} />
                )}
                <input type="file" accept="image/*" onChange={e => {
                  const file = e.target.files?.[0] || null
                  setItemImage(file)
                  if (file) setItemImagePreview(URL.createObjectURL(file))
                }} style={{ fontSize: '13px' }} />
              </div>
            </div>
            <button onClick={saveItem} className="btn btn-primary btn-block" disabled={saving} style={{ marginTop: '20px' }}>
              {saving ? <span className="spinner" /> : '保存菜品'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
