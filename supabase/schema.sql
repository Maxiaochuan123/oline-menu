-- ============================================
-- 在线菜单点餐系统 - 数据库初始化 SQL
-- 在 Supabase SQL Editor 中运行此脚本
-- ============================================

-- 1. 商家表
CREATE TABLE merchants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  shop_name TEXT NOT NULL DEFAULT '我的小店',
  is_accepting_orders BOOLEAN DEFAULT true,
  announcement TEXT,
  payment_qr_url TEXT,
  payment_qr_urls JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. 菜品分类
CREATE TABLE categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. 菜品
CREATE TABLE menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  price DECIMAL(10,2) NOT NULL,
  unit TEXT NOT NULL DEFAULT '个',
  image_url TEXT,
  is_new BOOLEAN DEFAULT true,
  is_available BOOLEAN DEFAULT true,
  new_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. 禁用日期
CREATE TABLE disabled_dates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  disabled_date DATE NOT NULL,
  reason TEXT,
  UNIQUE(merchant_id, disabled_date)
);

-- 5. 客户
CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  order_count INT DEFAULT 0,
  total_spent DECIMAL(10,2) DEFAULT 0,
  points INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(merchant_id, phone)
);

-- 6. 订单
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  order_type TEXT NOT NULL CHECK (order_type IN ('personal', 'company')),
  phone TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  address TEXT NOT NULL,
  scheduled_time TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'preparing', 'delivering', 'completed', 'cancelled')),
  cancelled_by TEXT CHECK (cancelled_by IN ('merchant', 'customer')),
  cancelled_at TIMESTAMPTZ,
  penalty_rate DECIMAL(5,4) DEFAULT 0,
  penalty_amount DECIMAL(10,2) DEFAULT 0,
  total_amount DECIMAL(10,2) NOT NULL,
  refund_amount DECIMAL(10,2),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 7. 订单明细
CREATE TABLE order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id UUID REFERENCES menu_items(id) ON DELETE SET NULL,
  item_name TEXT NOT NULL,
  item_price DECIMAL(10,2) NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  remark TEXT
);

-- ============================================
-- 索引
-- ============================================
CREATE INDEX idx_categories_merchant ON categories(merchant_id);
CREATE INDEX idx_menu_items_merchant ON menu_items(merchant_id);
CREATE INDEX idx_menu_items_category ON menu_items(category_id);
CREATE INDEX idx_customers_merchant ON customers(merchant_id);
CREATE INDEX idx_orders_merchant ON orders(merchant_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_scheduled ON orders(scheduled_time);
CREATE INDEX idx_order_items_order ON order_items(order_id);

-- ============================================
-- RLS (Row Level Security) 策略
-- ============================================
ALTER TABLE merchants ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE disabled_dates ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

-- 商家：登录用户可管理自己的数据
CREATE POLICY "merchants_own" ON merchants
  FOR ALL USING (auth.uid() = user_id);

-- 分类：商家管理自己的分类，客户可读
CREATE POLICY "categories_merchant_all" ON categories
  FOR ALL USING (merchant_id IN (SELECT id FROM merchants WHERE user_id = auth.uid()));
CREATE POLICY "categories_public_read" ON categories
  FOR SELECT USING (true);

-- 菜品：商家管理，客户可读
CREATE POLICY "menu_items_merchant_all" ON menu_items
  FOR ALL USING (merchant_id IN (SELECT id FROM merchants WHERE user_id = auth.uid()));
CREATE POLICY "menu_items_public_read" ON menu_items
  FOR SELECT USING (true);

-- 禁用日期：商家管理，客户可读
CREATE POLICY "disabled_dates_merchant_all" ON disabled_dates
  FOR ALL USING (merchant_id IN (SELECT id FROM merchants WHERE user_id = auth.uid()));
CREATE POLICY "disabled_dates_public_read" ON disabled_dates
  FOR SELECT USING (true);

-- 客户：商家可管理，客户端可创建和查询
CREATE POLICY "customers_merchant_all" ON customers
  FOR ALL USING (merchant_id IN (SELECT id FROM merchants WHERE user_id = auth.uid()));
CREATE POLICY "customers_public_read" ON customers
  FOR SELECT USING (true);
CREATE POLICY "customers_public_insert" ON customers
  FOR INSERT WITH CHECK (true);
CREATE POLICY "customers_public_update" ON customers
  FOR UPDATE USING (true);

-- 订单：商家可管理，匿名用户可创建和查询
CREATE POLICY "orders_merchant_all" ON orders
  FOR ALL USING (merchant_id IN (SELECT id FROM merchants WHERE user_id = auth.uid()));
CREATE POLICY "orders_public_select" ON orders
  FOR SELECT USING (true);
CREATE POLICY "orders_public_insert" ON orders
  FOR INSERT WITH CHECK (true);
CREATE POLICY "orders_public_update" ON orders
  FOR UPDATE USING (true);

-- 订单明细：跟随订单权限
CREATE POLICY "order_items_merchant_all" ON order_items
  FOR ALL USING (order_id IN (SELECT id FROM orders WHERE merchant_id IN (SELECT id FROM merchants WHERE user_id = auth.uid())));
CREATE POLICY "order_items_public_select" ON order_items
  FOR SELECT USING (true);
CREATE POLICY "order_items_public_insert" ON order_items
  FOR INSERT WITH CHECK (true);

-- ============================================
-- 商家表公开读取（客户端需要读取商家信息）
-- ============================================
CREATE POLICY "merchants_public_read" ON merchants
  FOR SELECT USING (true);

-- ============================================
-- 开启 Realtime 订阅
-- ============================================
ALTER PUBLICATION supabase_realtime ADD TABLE orders;

-- ============================================
-- Storage 策略（menu-images bucket）
-- 注意：请先在 Storage 控制台创建名为 menu-images 的 Public bucket
-- ============================================
CREATE POLICY "authenticated users can upload"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'menu-images');

CREATE POLICY "public can view images"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'menu-images');

CREATE POLICY "authenticated users can delete"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'menu-images');

-- ============================================
-- 客户评论与商家双向消息表
-- ============================================
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  sender TEXT NOT NULL CHECK (sender IN ('customer', 'merchant')),
  content TEXT NOT NULL,
  rating INT CHECK (rating BETWEEN 1 AND 5),
  is_read_by_merchant BOOLEAN DEFAULT false,
  is_read_by_customer BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "messages_public_read"   ON messages FOR SELECT USING (true);
CREATE POLICY "messages_public_insert" ON messages FOR INSERT WITH CHECK (true);
CREATE POLICY "messages_public_update" ON messages FOR UPDATE USING (true);

-- 开启 Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE messages;

