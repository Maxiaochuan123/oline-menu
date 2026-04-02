--
-- PostgreSQL database dump
--

-- Current canonical public schema snapshot exported from the development Supabase project.
-- Use this file to initialize a fresh database schema.


\restrict QaT2FleNH1mefvYa3hGzePSKFLv8OOpFVrhXhxl3gRcgRObYeeW3pmrQlSBP7S3

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.9 (Debian 17.9-1.pgdg13+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: claim_coupon(uuid, uuid, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_coupon(p_coupon_id uuid, p_customer_id uuid, p_expires_at timestamp with time zone) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
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


--
-- Name: update_merchant_rating(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_merchant_rating() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.rating IS NOT NULL THEN
    UPDATE merchants
    SET rating = (
      SELECT ROUND(AVG(rating)::numeric, 1)
      FROM messages
      WHERE merchant_id = NEW.merchant_id AND rating IS NOT NULL
    )
    WHERE id = NEW.merchant_id;
  END IF;
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    merchant_id uuid NOT NULL,
    name text NOT NULL,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: coupons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coupons (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    merchant_id uuid NOT NULL,
    title text NOT NULL,
    amount numeric(10,2) NOT NULL,
    min_spend numeric(10,2) DEFAULT 0,
    is_newcomer_reward boolean DEFAULT false,
    expiry_days integer DEFAULT 7,
    status text DEFAULT 'active'::text,
    created_at timestamp with time zone DEFAULT now(),
    target_type text DEFAULT 'all'::text,
    target_category_id uuid,
    target_customer_ids uuid[] DEFAULT '{}'::uuid[],
    target_item_ids text[] DEFAULT '{}'::text[],
    stackable boolean DEFAULT false,
    total_quantity integer,
    claimed_count integer DEFAULT 0,
    start_time timestamp with time zone DEFAULT now(),
    CONSTRAINT coupons_status_check CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text]))),
    CONSTRAINT coupons_target_type_check CHECK ((target_type = ANY (ARRAY['all'::text, 'category'::text, 'customer'::text])))
);


--
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    merchant_id uuid NOT NULL,
    phone text NOT NULL,
    name text,
    address text,
    order_count integer DEFAULT 0,
    total_spent numeric(10,2) DEFAULT 0,
    points integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: disabled_dates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.disabled_dates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    merchant_id uuid NOT NULL,
    disabled_date date NOT NULL,
    reason text
);


--
-- Name: menu_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.menu_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    merchant_id uuid NOT NULL,
    category_id uuid,
    name text NOT NULL,
    description text,
    price numeric(10,2) NOT NULL,
    image_url text,
    is_new boolean DEFAULT true,
    is_available boolean DEFAULT true,
    new_until timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    unit text DEFAULT '个'::text NOT NULL
);


--
-- Name: merchants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.merchants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    email text NOT NULL,
    shop_name text DEFAULT '我的小店'::text NOT NULL,
    is_accepting_orders boolean DEFAULT true,
    announcement text,
    payment_qr_url text,
    created_at timestamp with time zone DEFAULT now(),
    payment_qr_urls jsonb,
    rating numeric(3,1) DEFAULT 5.0,
    business_hours jsonb DEFAULT '{"open_time": "09:00", "close_time": "21:00", "is_enabled": false}'::jsonb,
    real_name text,
    id_card_num text,
    membership_levels jsonb
);


--
-- Name: COLUMN merchants.membership_levels; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.merchants.membership_levels IS '商家自定义会员等级配置。为空时使用系统默认方案。';


--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    merchant_id uuid NOT NULL,
    sender text NOT NULL,
    content text NOT NULL,
    rating integer,
    is_read_by_merchant boolean DEFAULT false,
    is_read_by_customer boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    msg_type text DEFAULT 'normal'::text,
    CONSTRAINT messages_msg_type_check CHECK ((msg_type = ANY (ARRAY['normal'::text, 'after_sales'::text, 'after_sales_closed'::text]))),
    CONSTRAINT messages_rating_check CHECK (((rating >= 1) AND (rating <= 5))),
    CONSTRAINT messages_sender_check CHECK ((sender = ANY (ARRAY['customer'::text, 'merchant'::text])))
);


--
-- Name: order_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    menu_item_id uuid,
    item_name text NOT NULL,
    item_price numeric(10,2) NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    remark text
);


--
-- Name: orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    merchant_id uuid NOT NULL,
    customer_id uuid,
    order_type text NOT NULL,
    phone text NOT NULL,
    customer_name text NOT NULL,
    address text NOT NULL,
    scheduled_time timestamp with time zone NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    cancelled_by text,
    cancelled_at timestamp with time zone,
    penalty_rate numeric(5,4) DEFAULT 0,
    penalty_amount numeric(10,2) DEFAULT 0,
    total_amount numeric(10,2) NOT NULL,
    refund_amount numeric(10,2),
    created_at timestamp with time zone DEFAULT now(),
    original_amount numeric(10,2) DEFAULT 0,
    vip_discount_rate numeric(4,2) DEFAULT 1.0,
    vip_discount_amount numeric(10,2) DEFAULT 0,
    coupon_discount_amount numeric(10,2) DEFAULT 0,
    confirmed_at timestamp with time zone,
    after_sales_status text DEFAULT 'none'::text,
    after_sales_reason text,
    after_sales_urge_count integer DEFAULT 0,
    after_sales_last_urge_at timestamp with time zone,
    after_sales_items jsonb,
    after_sales_images jsonb,
    coupon_ids uuid[] DEFAULT '{}'::uuid[],
    is_coupon_refunded boolean DEFAULT false,
    coupon_id uuid,
    CONSTRAINT orders_after_sales_status_check CHECK ((after_sales_status = ANY (ARRAY['none'::text, 'pending'::text, 'resolved'::text, 'rejected'::text]))),
    CONSTRAINT orders_cancelled_by_check CHECK ((cancelled_by = ANY (ARRAY['merchant'::text, 'customer'::text]))),
    CONSTRAINT orders_order_type_check CHECK ((order_type = ANY (ARRAY['personal'::text, 'company'::text]))),
    CONSTRAINT orders_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'preparing'::text, 'delivering'::text, 'completed'::text, 'cancelled'::text])))
);


--
-- Name: user_coupons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_coupons (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id uuid NOT NULL,
    coupon_id uuid NOT NULL,
    status text DEFAULT 'unused'::text,
    used_at timestamp with time zone,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT user_coupons_status_check CHECK ((status = ANY (ARRAY['unused'::text, 'used'::text, 'expired'::text])))
);


--
-- Name: categories categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);


--
-- Name: coupons coupons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupons
    ADD CONSTRAINT coupons_pkey PRIMARY KEY (id);


--
-- Name: customers customers_merchant_id_phone_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_merchant_id_phone_key UNIQUE (merchant_id, phone);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: disabled_dates disabled_dates_merchant_id_disabled_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disabled_dates
    ADD CONSTRAINT disabled_dates_merchant_id_disabled_date_key UNIQUE (merchant_id, disabled_date);


--
-- Name: disabled_dates disabled_dates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disabled_dates
    ADD CONSTRAINT disabled_dates_pkey PRIMARY KEY (id);


--
-- Name: menu_items menu_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.menu_items
    ADD CONSTRAINT menu_items_pkey PRIMARY KEY (id);


--
-- Name: merchants merchants_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchants
    ADD CONSTRAINT merchants_email_key UNIQUE (email);


--
-- Name: merchants merchants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchants
    ADD CONSTRAINT merchants_pkey PRIMARY KEY (id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: order_items order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_pkey PRIMARY KEY (id);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- Name: user_coupons user_coupons_customer_coupon_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_coupons
    ADD CONSTRAINT user_coupons_customer_coupon_unique UNIQUE (customer_id, coupon_id);


--
-- Name: user_coupons user_coupons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_coupons
    ADD CONSTRAINT user_coupons_pkey PRIMARY KEY (id);


--
-- Name: idx_categories_merchant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_categories_merchant ON public.categories USING btree (merchant_id);


--
-- Name: idx_coupons_merchant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coupons_merchant ON public.coupons USING btree (merchant_id);


--
-- Name: idx_coupons_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coupons_target ON public.coupons USING btree (target_type);


--
-- Name: idx_customers_merchant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_merchant ON public.customers USING btree (merchant_id);


--
-- Name: idx_menu_items_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_menu_items_category ON public.menu_items USING btree (category_id);


--
-- Name: idx_menu_items_merchant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_menu_items_merchant ON public.menu_items USING btree (merchant_id);


--
-- Name: idx_order_items_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_order ON public.order_items USING btree (order_id);


--
-- Name: idx_orders_coupon_ids; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_coupon_ids ON public.orders USING gin (coupon_ids);


--
-- Name: idx_orders_merchant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_merchant ON public.orders USING btree (merchant_id);


--
-- Name: idx_orders_scheduled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_scheduled ON public.orders USING btree (scheduled_time);


--
-- Name: idx_orders_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_status ON public.orders USING btree (status);


--
-- Name: idx_user_coupons_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_coupons_customer ON public.user_coupons USING btree (customer_id);


--
-- Name: idx_user_coupons_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_coupons_status ON public.user_coupons USING btree (status);


--
-- Name: messages on_message_rating_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER on_message_rating_insert AFTER INSERT OR UPDATE OF rating ON public.messages FOR EACH ROW EXECUTE FUNCTION public.update_merchant_rating();


--
-- Name: categories categories_merchant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_merchant_id_fkey FOREIGN KEY (merchant_id) REFERENCES public.merchants(id) ON DELETE CASCADE;


--
-- Name: coupons coupons_merchant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupons
    ADD CONSTRAINT coupons_merchant_id_fkey FOREIGN KEY (merchant_id) REFERENCES public.merchants(id) ON DELETE CASCADE;


--
-- Name: coupons coupons_target_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupons
    ADD CONSTRAINT coupons_target_category_id_fkey FOREIGN KEY (target_category_id) REFERENCES public.categories(id) ON DELETE SET NULL;


--
-- Name: customers customers_merchant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_merchant_id_fkey FOREIGN KEY (merchant_id) REFERENCES public.merchants(id) ON DELETE CASCADE;


--
-- Name: disabled_dates disabled_dates_merchant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disabled_dates
    ADD CONSTRAINT disabled_dates_merchant_id_fkey FOREIGN KEY (merchant_id) REFERENCES public.merchants(id) ON DELETE CASCADE;


--
-- Name: orders fk_orders_coupon; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT fk_orders_coupon FOREIGN KEY (coupon_id) REFERENCES public.coupons(id) ON DELETE SET NULL;


--
-- Name: menu_items menu_items_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.menu_items
    ADD CONSTRAINT menu_items_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE SET NULL;


--
-- Name: menu_items menu_items_merchant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.menu_items
    ADD CONSTRAINT menu_items_merchant_id_fkey FOREIGN KEY (merchant_id) REFERENCES public.merchants(id) ON DELETE CASCADE;


--
-- Name: merchants merchants_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchants
    ADD CONSTRAINT merchants_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: messages messages_merchant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_merchant_id_fkey FOREIGN KEY (merchant_id) REFERENCES public.merchants(id) ON DELETE CASCADE;


--
-- Name: messages messages_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_items order_items_menu_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_menu_item_id_fkey FOREIGN KEY (menu_item_id) REFERENCES public.menu_items(id) ON DELETE SET NULL;


--
-- Name: order_items order_items_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: orders orders_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;


--
-- Name: orders orders_merchant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_merchant_id_fkey FOREIGN KEY (merchant_id) REFERENCES public.merchants(id) ON DELETE CASCADE;


--
-- Name: user_coupons user_coupons_coupon_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_coupons
    ADD CONSTRAINT user_coupons_coupon_id_fkey FOREIGN KEY (coupon_id) REFERENCES public.coupons(id) ON DELETE CASCADE;


--
-- Name: user_coupons user_coupons_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_coupons
    ADD CONSTRAINT user_coupons_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

--
-- Name: categories categories_merchant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY categories_merchant_all ON public.categories USING ((merchant_id IN ( SELECT merchants.id
   FROM public.merchants
  WHERE (merchants.user_id = auth.uid()))));


--
-- Name: categories categories_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY categories_public_read ON public.categories FOR SELECT USING (true);


--
-- Name: coupons; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;

--
-- Name: coupons coupons_merchant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY coupons_merchant_all ON public.coupons USING ((merchant_id IN ( SELECT merchants.id
   FROM public.merchants
  WHERE (merchants.user_id = auth.uid()))));


--
-- Name: coupons coupons_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY coupons_public_read ON public.coupons FOR SELECT USING ((status = 'active'::text));


--
-- Name: customers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

--
-- Name: customers customers_merchant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY customers_merchant_all ON public.customers USING ((merchant_id IN ( SELECT merchants.id
   FROM public.merchants
  WHERE (merchants.user_id = auth.uid()))));


--
-- Name: customers customers_public_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY customers_public_insert ON public.customers FOR INSERT WITH CHECK (true);


--
-- Name: customers customers_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY customers_public_read ON public.customers FOR SELECT USING (true);


--
-- Name: customers customers_public_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY customers_public_update ON public.customers FOR UPDATE USING (true);


--
-- Name: disabled_dates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.disabled_dates ENABLE ROW LEVEL SECURITY;

--
-- Name: disabled_dates disabled_dates_merchant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY disabled_dates_merchant_all ON public.disabled_dates USING ((merchant_id IN ( SELECT merchants.id
   FROM public.merchants
  WHERE (merchants.user_id = auth.uid()))));


--
-- Name: disabled_dates disabled_dates_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY disabled_dates_public_read ON public.disabled_dates FOR SELECT USING (true);


--
-- Name: menu_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;

--
-- Name: menu_items menu_items_merchant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY menu_items_merchant_all ON public.menu_items USING ((merchant_id IN ( SELECT merchants.id
   FROM public.merchants
  WHERE (merchants.user_id = auth.uid()))));


--
-- Name: menu_items menu_items_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY menu_items_public_read ON public.menu_items FOR SELECT USING (true);


--
-- Name: merchants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.merchants ENABLE ROW LEVEL SECURITY;

--
-- Name: merchants merchants_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY merchants_own ON public.merchants USING ((auth.uid() = user_id));


--
-- Name: merchants merchants_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY merchants_public_read ON public.merchants FOR SELECT USING (true);


--
-- Name: messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

--
-- Name: messages messages_public_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY messages_public_insert ON public.messages FOR INSERT WITH CHECK (true);


--
-- Name: messages messages_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY messages_public_read ON public.messages FOR SELECT USING (true);


--
-- Name: messages messages_public_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY messages_public_update ON public.messages FOR UPDATE USING (true);


--
-- Name: order_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

--
-- Name: order_items order_items_merchant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY order_items_merchant_all ON public.order_items USING ((order_id IN ( SELECT orders.id
   FROM public.orders
  WHERE (orders.merchant_id IN ( SELECT merchants.id
           FROM public.merchants
          WHERE (merchants.user_id = auth.uid()))))));


--
-- Name: order_items order_items_public_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY order_items_public_insert ON public.order_items FOR INSERT WITH CHECK (true);


--
-- Name: order_items order_items_public_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY order_items_public_select ON public.order_items FOR SELECT USING (true);


--
-- Name: orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

--
-- Name: orders orders_merchant_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY orders_merchant_all ON public.orders USING ((merchant_id IN ( SELECT merchants.id
   FROM public.merchants
  WHERE (merchants.user_id = auth.uid()))));


--
-- Name: orders orders_public_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY orders_public_insert ON public.orders FOR INSERT WITH CHECK (true);


--
-- Name: orders orders_public_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY orders_public_select ON public.orders FOR SELECT USING (true);


--
-- Name: orders orders_public_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY orders_public_update ON public.orders FOR UPDATE USING (true);


--
-- Name: user_coupons; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_coupons ENABLE ROW LEVEL SECURITY;

--
-- Name: user_coupons user_coupons_merchant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_coupons_merchant_read ON public.user_coupons FOR SELECT USING ((coupon_id IN ( SELECT coupons.id
   FROM public.coupons
  WHERE (coupons.merchant_id IN ( SELECT merchants.id
           FROM public.merchants
          WHERE (merchants.user_id = auth.uid()))))));


--
-- Name: user_coupons user_coupons_public_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_coupons_public_insert ON public.user_coupons FOR INSERT WITH CHECK (true);


--
-- Name: user_coupons user_coupons_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_coupons_public_read ON public.user_coupons FOR SELECT USING (true);


--
-- Name: user_coupons user_coupons_public_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_coupons_public_update ON public.user_coupons FOR UPDATE USING (true);


--
-- PostgreSQL database dump complete
--

\unrestrict QaT2FleNH1mefvYa3hGzePSKFLv8OOpFVrhXhxl3gRcgRObYeeW3pmrQlSBP7S3

