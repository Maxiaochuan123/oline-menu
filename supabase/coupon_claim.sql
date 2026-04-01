-- supabase/coupon_claim.sql
-- Safe coupon claim RPC with duplicate-claim protection.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_coupons_customer_coupon_unique'
  ) THEN
    ALTER TABLE user_coupons
      ADD CONSTRAINT user_coupons_customer_coupon_unique
      UNIQUE (customer_id, coupon_id);
  END IF;
END $$;

DROP FUNCTION IF EXISTS claim_coupon(uuid, uuid, timestamptz);

CREATE OR REPLACE FUNCTION claim_coupon(
  p_coupon_id uuid,
  p_customer_id uuid,
  p_expires_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_quantity int;
  v_claimed int;
  v_status text;
  v_inserted_coupon_id uuid;
BEGIN
  SELECT total_quantity, claimed_count, status
  INTO v_quantity, v_claimed, v_status
  FROM coupons
  WHERE id = p_coupon_id
  FOR UPDATE;

  IF NOT FOUND OR v_status != 'active' THEN
    RETURN false;
  END IF;

  IF v_quantity IS NOT NULL AND v_claimed >= v_quantity THEN
    RETURN false;
  END IF;

  INSERT INTO user_coupons (customer_id, coupon_id, status, expires_at)
  VALUES (p_customer_id, p_coupon_id, 'unused', p_expires_at)
  ON CONFLICT (customer_id, coupon_id) DO NOTHING
  RETURNING coupon_id INTO v_inserted_coupon_id;

  IF v_inserted_coupon_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE coupons
  SET claimed_count = claimed_count + 1
  WHERE id = p_coupon_id;

  RETURN true;
END;
$$;
