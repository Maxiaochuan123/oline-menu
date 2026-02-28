-- 优惠券表新增字段
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS target_item_ids text[] DEFAULT '{}';
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS stackable boolean DEFAULT false;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS total_quantity int;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS claimed_count int DEFAULT 0;
