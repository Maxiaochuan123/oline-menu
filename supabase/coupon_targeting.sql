-- ============================================
-- 优惠券定向维度扩展 - 增量 SQL
-- 在 Supabase SQL Editor 中运行
-- ============================================

-- 1. 定向类型：all=全场, category=指定分类, customer=指定用户
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS target_type TEXT DEFAULT 'all' CHECK (target_type IN ('all', 'category', 'customer'));

-- 2. 指定分类ID（target_type='category' 时使用）
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS target_category_id UUID REFERENCES categories(id) ON DELETE SET NULL;

-- 3. 指定用户ID列表（target_type='customer' 时使用，存 UUID 数组）
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS target_customer_ids UUID[] DEFAULT '{}';

-- 4. 索引优化
CREATE INDEX IF NOT EXISTS idx_coupons_target ON coupons(target_type);
