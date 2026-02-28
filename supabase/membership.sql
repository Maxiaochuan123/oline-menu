-- ============================================
-- 会员等级 & 优惠券系统 - 增量 SQL
-- 直接在 Supabase SQL Editor 中运行此脚本
-- ============================================

-- ============================================
-- 1. 扩展 orders 表，记录折扣明细
-- ============================================
ALTER TABLE orders ADD COLUMN IF NOT EXISTS original_amount  DECIMAL(10,2) DEFAULT 0;  -- 折扣前原价
ALTER TABLE orders ADD COLUMN IF NOT EXISTS vip_discount_rate DECIMAL(4,2) DEFAULT 1.0; -- VIP 折扣率 (0.85 表示 85折)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS vip_discount_amount DECIMAL(10,2) DEFAULT 0; -- VIP 减免金额
ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_discount_amount DECIMAL(10,2) DEFAULT 0; -- 优惠券减免金额
ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_id UUID;                              -- 使用的优惠券

-- ============================================
-- 2. 优惠券主表（商家发放模板）
-- ============================================
CREATE TABLE IF NOT EXISTS coupons (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,             -- 优惠券名称，如"新人立减 5 元"
  amount      DECIMAL(10,2) NOT NULL,    -- 减免金额（元）
  min_spend   DECIMAL(10,2) DEFAULT 0,   -- 使用门槛（0 = 无门槛）
  is_global   BOOLEAN DEFAULT false,     -- true = 全部用户可领，false = 指定用户发放
  expiry_days INTEGER DEFAULT 7,         -- 领取后有效天数
  status      TEXT DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- 3. 用户持有的优惠券
-- ============================================
CREATE TABLE IF NOT EXISTS user_coupons (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  coupon_id   UUID NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  status      TEXT DEFAULT 'unused' CHECK (status IN ('unused', 'used', 'expired')),
  used_at     TIMESTAMPTZ,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- 4. 索引
-- ============================================
CREATE INDEX IF NOT EXISTS idx_coupons_merchant    ON coupons(merchant_id);
CREATE INDEX IF NOT EXISTS idx_user_coupons_customer ON user_coupons(customer_id);
CREATE INDEX IF NOT EXISTS idx_user_coupons_status  ON user_coupons(status);

-- ============================================
-- 5. RLS 策略
-- ============================================
ALTER TABLE coupons      ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_coupons ENABLE ROW LEVEL SECURITY;

-- 优惠券：商家可完全管理，客户端可读 active 券
CREATE POLICY "coupons_merchant_all" ON coupons
  FOR ALL USING (merchant_id IN (SELECT id FROM merchants WHERE user_id = auth.uid()));
CREATE POLICY "coupons_public_read" ON coupons
  FOR SELECT TO public USING (status = 'active');

-- 用户持有的券：商家可读，客户端可读写
CREATE POLICY "user_coupons_merchant_read" ON user_coupons
  FOR SELECT USING (
    coupon_id IN (SELECT id FROM coupons WHERE merchant_id IN (
      SELECT id FROM merchants WHERE user_id = auth.uid()
    ))
  );
CREATE POLICY "user_coupons_public_read"   ON user_coupons FOR SELECT TO public USING (true);
CREATE POLICY "user_coupons_public_insert" ON user_coupons FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "user_coupons_public_update" ON user_coupons FOR UPDATE TO public USING (true);

-- ============================================
-- 6. orders 表外键（在所有表都存在后添加）
-- ============================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_orders_coupon'
      AND table_name = 'orders'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT fk_orders_coupon
      FOREIGN KEY (coupon_id) REFERENCES coupons(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ============================================
-- 完成！VIP 等级规则（在前端代码中定义，无需数据库存储）
-- 0   ~ 99   积分：原价     (1.0)  新客有 5 元优惠券
-- 100 ~ 200  积分：98折  (0.98)
-- 201 ~ 500  积分：95折  (0.95)
-- 501 ~ 1000 积分：92折  (0.92)
-- 1001~ 3000 积分：88折  (0.88)
-- 3001+      积分：85折  (0.85)
-- ============================================

-- 修正：让 customers.name 字段可空，以支持仅手机号完成登录
ALTER TABLE customers ALTER COLUMN name DROP NOT NULL;
