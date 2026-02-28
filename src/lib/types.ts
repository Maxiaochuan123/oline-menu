export interface Merchant {
  id: string
  email: string
  shop_name: string
  is_accepting_orders: boolean
  announcement: string | null
  payment_qr_url: string | null
  payment_qr_urls: { wechat?: string; alipay?: string } | null
  rating?: number | null
  created_at: string
}

export interface Category {
  id: string
  merchant_id: string
  name: string
  sort_order: number
  rating?: number | null
  created_at: string
}

export interface MenuItem {
  id: string
  merchant_id: string
  category_id: string
  name: string
  description: string | null
  price: number
  unit: string
  image_url: string | null
  is_new: boolean
  is_available: boolean
  new_until: string | null
  rating?: number | null
  created_at: string
}

export interface Customer {
  id: string
  merchant_id: string
  phone: string
  name: string
  address: string | null
  order_count: number
  total_spent: number
  points: number
  rating?: number | null
  created_at: string
}

export type OrderType = 'personal' | 'company'
export type OrderStatus = 'pending' | 'preparing' | 'delivering' | 'completed' | 'cancelled'
export type CancelledBy = 'merchant' | 'customer'

export interface Order {
  id: string
  merchant_id: string
  customer_id: string | null
  order_type: OrderType
  phone: string
  customer_name: string
  address: string
  scheduled_time: string
  status: OrderStatus
  cancelled_by: CancelledBy | null
  cancelled_at: string | null
  confirmed_at: string | null // 商家接单时间
  penalty_rate: number | null
  penalty_amount: number | null
  total_amount: number
  refund_amount: number | null
  rating?: number | null
  created_at: string
  // 折扣相关字段
  original_amount: number
  vip_discount_rate: number
  vip_discount_amount: number
  coupon_discount_amount: number
  coupon_id: string | null
  // 售后相关
  after_sales_status: 'none' | 'pending' | 'resolved' | 'rejected'
  after_sales_reason: string | null
  after_sales_urge_count: number
  after_sales_last_urge_at: string | null
  after_sales_items?: string[] | null
  after_sales_images?: string[] | null
}

export interface OrderItem {
  id: string
  order_id: string
  menu_item_id: string
  item_name: string
  item_price: number
  quantity: number
  remark: string | null
}

export interface CartItem {
  menuItem: MenuItem
  quantity: number
  remark: string
}

export interface DisabledDate {
  id: string
  merchant_id: string
  disabled_date: string
  reason: string | null
}

export interface Message {
  id: string
  order_id: string
  merchant_id: string
  sender: 'customer' | 'merchant'
  content: string
  rating: number | null   // 1-5 星，仅客户发送时可有
  msg_type: 'normal' | 'after_sales' | 'after_sales_closed'
  is_read_by_merchant: boolean
  is_read_by_customer: boolean
  rating?: number | null
  created_at: string
}

// ---- 优惠�?----
export type CouponTargetType = 'all' | 'category' | 'customer'

export interface Coupon {
  id: string
  merchant_id: string
  title: string
  amount: number
  min_spend: number
  is_global: boolean
  expiry_days: number
  status: 'active' | 'disabled'
  target_type: CouponTargetType   // 定向类型：all=全场, category=指定分类, customer=指定用户
  target_category_id: string | null // 指定分类ID（target_type=category 时）
  target_customer_ids: string[]     // 指定用户ID列表（target_type=customer 时）
  target_item_ids: string[]         // 指定菜品ID列表
  stackable: boolean                // 可叠加使�?
  total_quantity: number | null      // 发放总量（null=不限量）
  claimed_count: number              // 已领取数�?
  rating?: number | null
  created_at: string
}

export interface UserCoupon {
  id: string
  customer_id: string
  coupon_id: string
  status: 'unused' | 'used' | 'expired'
  used_at: string | null
  expires_at: string
  rating?: number | null
  created_at: string
  coupon?: Coupon  // 关联数据
}
