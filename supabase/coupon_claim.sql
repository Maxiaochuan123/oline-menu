-- supabase/coupon_claim.sql
-- 用于安全领取优惠券，防止超发（原子操作）

DROP FUNCTION IF EXISTS claim_coupon(uuid, uuid, uuid, timestamptz);

CREATE OR REPLACE FUNCTION claim_coupon(
  p_coupon_id uuid,
  p_customer_id uuid,
  p_expires_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER -- 以数据库所有权者的权限运行
AS $$
DECLARE
  v_quantity int;
  v_claimed int;
  v_status text;
  v_exists boolean;
BEGIN
  -- 检查是否已领过
  SELECT EXISTS(
    SELECT 1 FROM user_coupons
    WHERE coupon_id = p_coupon_id AND customer_id = p_customer_id
  ) INTO v_exists;

  IF v_exists THEN
    RETURN false; -- 每人限领一张，已领过则返回失败
  END IF;

  -- 锁定该优惠券记录进行检查和更新 (FOR UPDATE)
  SELECT total_quantity, claimed_count, status
  INTO v_quantity, v_claimed, v_status
  FROM coupons
  WHERE id = p_coupon_id
  FOR UPDATE;

  -- 如果优惠券已禁用，或限量且已发完
  IF v_status != 'active' THEN
    RETURN false;
  END IF;

  IF v_quantity IS NOT NULL AND v_claimed >= v_quantity THEN
    RETURN false;
  END IF;

  -- 更新领取数量
  UPDATE coupons
  SET claimed_count = claimed_count + 1
  WHERE id = p_coupon_id;

  -- 插入用户优惠券记录
  INSERT INTO user_coupons (customer_id, coupon_id, status, expires_at)
  VALUES (p_customer_id, p_coupon_id, 'unused', p_expires_at);

  RETURN true;
END;
$$;
