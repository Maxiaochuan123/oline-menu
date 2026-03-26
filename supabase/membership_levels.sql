-- ============================================
-- 商家自定义会员等级配置
-- 在 Supabase SQL Editor 中执行
-- ============================================

ALTER TABLE merchants
ADD COLUMN IF NOT EXISTS membership_levels JSONB;

COMMENT ON COLUMN merchants.membership_levels IS
'商家自定义会员等级配置。为空时使用系统默认方案。';
