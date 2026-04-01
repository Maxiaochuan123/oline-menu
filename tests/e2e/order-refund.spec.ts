import { expect, test } from '@playwright/test'

import {
  createCustomerOrder,
  createMerchantAccount,
  createUsedCouponForCustomerAsMerchant,
  getCustomerById,
  getMessagesByOrder,
  getOrderById,
  getUserCouponById,
  updateOrder,
} from './helpers/supabase'

const POLL_TIMEOUT_MS = 15_000

async function openOrderFromOrdersPageById(
  page: import('@playwright/test').Page,
  phone: string,
  orderId: string,
) {
  await page.goto('/orders')
  const phoneRow = page.getByTestId(`orders-phone-group-${phone}`).first()
  await expect(phoneRow).toBeVisible({ timeout: POLL_TIMEOUT_MS })
  await phoneRow.click()

  const orderRow = page.getByTestId(`orders-order-row-${orderId}`).first()
  await expect(orderRow).toBeVisible({ timeout: POLL_TIMEOUT_MS })
  await orderRow.click()
  await expect(page.getByTestId('merchant-order-modal')).toBeVisible()
}

async function clickNextStatusAndConfirm(
  page: import('@playwright/test').Page,
  options: { doubleConfirm?: boolean } = {},
) {
  await page.getByTestId('merchant-order-next-status-button').click()

  const confirmButton = page.getByRole('button', { name: '确认更新' })
  if (options.doubleConfirm) {
    await confirmButton.dblclick()
    return
  }

  await confirmButton.click()
}

async function submitRefundAndConfirm(
  page: import('@playwright/test').Page,
  options: { doubleConfirm?: boolean; couponTitle?: string } = {},
) {
  await page.getByTestId('merchant-after-sales-handle-button').click()
  await page.getByTestId('merchant-refund-fixed-input').fill('20')

  if (options.couponTitle) {
    const couponLabel = page.locator('label').filter({ hasText: options.couponTitle }).first()
    await expect(couponLabel).toBeVisible({ timeout: POLL_TIMEOUT_MS })
    await couponLabel.click()
    await expect(couponLabel.getByRole('checkbox')).toBeChecked()
  }

  await page.getByRole('button', { name: '同意入账并完结' }).click()

  const confirmButton = page.getByRole('button', { name: '确认退款' })
  if (options.doubleConfirm) {
    await confirmButton.dblclick()
    return
  }

  await confirmButton.click()
}

async function cancelOrderAndConfirm(
  page: import('@playwright/test').Page,
  options: { doubleConfirm?: boolean } = {},
) {
  await page.getByTestId('merchant-order-cancel-button').click()

  const confirmButton = page.getByRole('button', { name: '确认极速取消' })
  if (options.doubleConfirm) {
    await confirmButton.dblclick()
    return
  }

  await confirmButton.click()
}

async function rejectAfterSalesAndConfirm(
  page: import('@playwright/test').Page,
  options: { doubleConfirm?: boolean } = {},
) {
  await page.getByTestId('merchant-after-sales-handle-button').click()
  await page.getByRole('button', { name: '驳回售后' }).click()

  const confirmButton = page.getByRole('button', { name: '确认驳回' })
  if (options.doubleConfirm) {
    await confirmButton.dblclick()
    return
  }

  await confirmButton.click()
}

async function loginAsMerchant(page: import('@playwright/test').Page, phone: string, password: string) {
  await page.goto('/login')
  await page.locator('input[type="tel"]').fill(phone)
  await page.locator('input[type="password"]').fill(password)
  await page.locator('form button[type="submit"]').click()
  await page.waitForURL(/\/dashboard$/)
}

test.describe('order cancellation flows', () => {
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(60_000)

  test('merchant moving an order into preparing writes confirmed_at', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id)

    await loginAsMerchant(page, phone, password)
    await page.goto('/orders')

    await openOrderFromOrdersPageById(page, order.phone, order.id)
    await page.locator('button').filter({ hasText: '制作中' }).click()
    await page.locator('button').filter({ hasText: '确认更新' }).click()

    await expect
      .poll(async () => getOrderById(order.id), {
        message: 'expected order status to become preparing and confirmed_at to be written',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        status: 'preparing',
      })

    const updatedOrder = await getOrderById(order.id)
    expect(updatedOrder.confirmed_at).toBeTruthy()
  })

  test('double confirming next status only advances the order once', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id)

    await loginAsMerchant(page, phone, password)
    await page.goto('/orders')

    await openOrderFromOrdersPageById(page, order.phone, order.id)
    await clickNextStatusAndConfirm(page, { doubleConfirm: true })

    await expect
      .poll(async () => getOrderById(order.id), {
        message: 'expected double confirm to advance the order only to preparing',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        status: 'preparing',
      })

    const updatedOrder = await getOrderById(order.id)
    expect(updatedOrder.confirmed_at).toBeTruthy()

    await page.goto('/orders')
    await openOrderFromOrdersPageById(page, order.phone, order.id)
    await expect(page.getByTestId('merchant-order-next-status-button')).toContainText('配送中')
  })

  test('double confirming delivering to completed only completes the order once', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id)

    await updateOrder(order.id, {
      status: 'delivering',
      confirmed_at: new Date().toISOString(),
      after_sales_status: 'none',
    })

    await loginAsMerchant(page, phone, password)
    await page.goto('/orders')

    await openOrderFromOrdersPageById(page, order.phone, order.id)
    await clickNextStatusAndConfirm(page, { doubleConfirm: true })

    await expect
      .poll(async () => getOrderById(order.id), {
        message: 'expected double confirm to move delivering order only to completed',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        status: 'completed',
      })

    await page.goto('/orders')
    await openOrderFromOrdersPageById(page, order.phone, order.id)
    await expect(page.getByTestId('merchant-order-next-status-button')).toHaveCount(0)
    await expect(page.getByTestId('merchant-order-cancel-button')).toHaveCount(0)
  })

  test('double confirming preparing to delivering only advances once and keeps confirmed_at intact', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id)
    const confirmedAt = new Date(Date.now() - 20 * 60 * 1000).toISOString()

    await updateOrder(order.id, {
      status: 'preparing',
      confirmed_at: confirmedAt,
      after_sales_status: 'none',
    })

    await loginAsMerchant(page, phone, password)
    await page.goto('/orders')

    await openOrderFromOrdersPageById(page, order.phone, order.id)
    await clickNextStatusAndConfirm(page, { doubleConfirm: true })

    await expect
      .poll(async () => getOrderById(order.id), {
        message: 'expected double confirm to move preparing order only to delivering',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        status: 'delivering',
      })

    const updatedOrder = await getOrderById(order.id)
    expect(Date.parse(updatedOrder.confirmed_at ?? '')).toBe(Date.parse(confirmedAt))

    await page.goto('/orders')
    await openOrderFromOrdersPageById(page, order.phone, order.id)
    await expect(page.getByTestId('merchant-order-next-status-button')).toContainText('已完成')
  })

  test('customer cancel preview reflects elapsed preparing time', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { customer, order } = await createCustomerOrder(merchant.id)

    await loginAsMerchant(page, phone, password)
    await page.goto('/orders')

    await openOrderFromOrdersPageById(page, order.phone, order.id)
    await page.locator('button').filter({ hasText: '制作中' }).click()
    await page.locator('button').filter({ hasText: '确认更新' }).click()

    await expect
      .poll(async () => getOrderById(order.id), {
        message: 'expected order to enter preparing before previewing cancellation',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        status: 'preparing',
      })

    await updateOrder(order.id, {
      confirmed_at: new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString(),
    })

    await page.goto(`/m/${merchant.id}/order/${order.id}`)
    await page.locator('button').filter({ hasText: '申请退单' }).click()

    await expect(page.getByText('预计退款')).toBeVisible()
    await expect(page.getByText('¥13.20')).toBeVisible()

    await page.getByRole('button', { name: '计划有变' }).click()
    await page.getByRole('button', { name: '确认取消' }).click()

    await expect
      .poll(async () => getOrderById(order.id), {
        message: 'expected order to be cancelled with capped preparing penalty',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        status: 'cancelled',
      })

    const cancelledOrder = await getOrderById(order.id)
    expect(Number(cancelledOrder.penalty_rate)).toBe(0.8)
    expect(Number(cancelledOrder.penalty_amount)).toBe(52.8)
    expect(Number(cancelledOrder.refund_amount)).toBe(13.2)

    await expect
      .poll(async () => getCustomerById(customer.id), {
        message: 'expected capped cancellation to roll customer assets to the net-spent state',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        order_count: 1,
        points: 52,
      })

    const customerAfterCancel = await getCustomerById(customer.id)
    expect(Number(customerAfterCancel.total_spent)).toBe(52.8)
  })

  test('customer full cancellation returns used coupon', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { customer, order } = await createCustomerOrder(merchant.id, 60)
    const { coupon, userCoupon } = await createUsedCouponForCustomerAsMerchant({
      merchantId: merchant.id,
      merchantPhone: phone,
      merchantPassword: password,
      customerId: customer.id,
      amount: 6,
    })

    await updateOrder(order.id, {
      original_amount: 66,
      coupon_discount_amount: 6,
      coupon_ids: [coupon.id],
    })

    await page.goto(`/m/${merchant.id}/order/${order.id}`)
    await page.getByRole('button', { name: '取消订单' }).click()
    await page.getByRole('button', { name: '计划有变' }).click()
    await page.getByRole('button', { name: '确认取消' }).click()

    await expect
      .poll(async () => getOrderById(order.id), {
        message: 'expected pending order cancellation to finish and refund the coupon',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        status: 'cancelled',
        is_coupon_refunded: true,
      })

    const cancelledOrder = await getOrderById(order.id)
    expect(Number(cancelledOrder.refund_amount)).toBe(60)
    expect(Number(cancelledOrder.penalty_rate)).toBe(0)

    await expect
      .poll(async () => getCustomerById(customer.id), {
        message: 'expected customer assets to be rolled back after full cancellation',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        order_count: 0,
        points: 0,
      })

    const customerAfterCancel = await getCustomerById(customer.id)
    expect(Number(customerAfterCancel.total_spent)).toBe(0)

    await expect
      .poll(async () => getUserCouponById(userCoupon.id), {
        message: 'expected used coupon to return to unused after full cancellation',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        status: 'unused',
      })
  })

  test('merchant partial refund can also return a selected coupon', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { customer, order } = await createCustomerOrder(merchant.id, 60)
    const { coupon, userCoupon } = await createUsedCouponForCustomerAsMerchant({
      merchantId: merchant.id,
      merchantPhone: phone,
      merchantPassword: password,
      customerId: customer.id,
      amount: 6,
    })

    await updateOrder(order.id, {
      status: 'completed',
      after_sales_status: 'pending',
      after_sales_reason: '餐品有问题',
      original_amount: 66,
      coupon_discount_amount: 6,
      coupon_ids: [coupon.id],
    })

    await loginAsMerchant(page, phone, password)
    await page.goto('/orders')

    await openOrderFromOrdersPageById(page, order.phone, order.id)
    await submitRefundAndConfirm(page, { couponTitle: coupon.title })
    await expect
      .poll(async () => getOrderById(order.id), {
        message: 'expected merchant partial refund to resolve after-sales and optionally refund coupon',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        status: 'completed',
        after_sales_status: 'resolved',
        is_coupon_refunded: true,
      })

    const refundedOrder = await getOrderById(order.id)
    expect(Number(refundedOrder.refund_amount)).toBe(20)

    await expect
      .poll(async () => getCustomerById(customer.id), {
        message: 'expected merchant partial refund to update customer net spend and points',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        order_count: 1,
        points: 40,
      })

    const customerAfterRefund = await getCustomerById(customer.id)
    expect(Number(customerAfterRefund.total_spent)).toBe(40)

    await expect
      .poll(async () => getUserCouponById(userCoupon.id), {
        message: 'expected selected coupon to be returned after merchant partial refund',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        status: 'unused',
      })
  })

  test('double confirming after-sales refund only settles assets once', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { customer, order } = await createCustomerOrder(merchant.id, 60)
    const { coupon, userCoupon } = await createUsedCouponForCustomerAsMerchant({
      merchantId: merchant.id,
      merchantPhone: phone,
      merchantPassword: password,
      customerId: customer.id,
      amount: 6,
    })

    await updateOrder(order.id, {
      status: 'completed',
      after_sales_status: 'pending',
      after_sales_reason: '重复点击售后退款测试',
      original_amount: 66,
      coupon_discount_amount: 6,
      coupon_ids: [coupon.id],
    })

    await loginAsMerchant(page, phone, password)
    await page.goto('/orders')

    await openOrderFromOrdersPageById(page, order.phone, order.id)
    await submitRefundAndConfirm(page, { doubleConfirm: true, couponTitle: coupon.title })

    await expect
      .poll(async () => getOrderById(order.id), {
        message: 'expected double refund confirmation to settle the order only once',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        status: 'completed',
        after_sales_status: 'resolved',
        is_coupon_refunded: true,
      })

    const refundedOrder = await getOrderById(order.id)
    expect(Number(refundedOrder.refund_amount)).toBe(20)

    await expect
      .poll(async () => getCustomerById(customer.id), {
        message: 'expected customer assets to be rolled back only once after double refund click',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        order_count: 1,
        points: 40,
      })

    const customerAfterRefund = await getCustomerById(customer.id)
    expect(Number(customerAfterRefund.total_spent)).toBe(40)

    await expect
      .poll(async () => getUserCouponById(userCoupon.id), {
        message: 'expected coupon to be returned only once after double refund click',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        status: 'unused',
      })
  })

  test('customer can start a delivering-stage negotiation', async ({ page }) => {
    const { merchant } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id, 48)

    await updateOrder(order.id, {
      status: 'delivering',
      after_sales_status: 'none',
    })

    await page.goto(`/m/${merchant.id}/order/${order.id}`)
    await page.getByRole('button', { name: '与商家协商' }).click()

    await expect
      .poll(async () => getOrderById(order.id), {
        message: 'expected delivering-stage negotiation to mark order as after-sales pending',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        status: 'delivering',
        after_sales_status: 'pending',
      })
  })

  test('merchant can reject an after-sales request', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id, 58)

    await updateOrder(order.id, {
      status: 'completed',
      after_sales_status: 'pending',
      after_sales_reason: '餐品口味不符合预期',
    })

    await loginAsMerchant(page, phone, password)
    await page.goto('/orders')

    await openOrderFromOrdersPageById(page, order.phone, order.id)
    await rejectAfterSalesAndConfirm(page)

    await expect
      .poll(async () => getOrderById(order.id), {
        message: 'expected merchant rejection to mark after-sales as rejected and keep order completed',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        status: 'completed',
        after_sales_status: 'rejected',
      })
  })

  test('double confirming after-sales rejection only appends one closing message', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id, 58)

    await updateOrder(order.id, {
      status: 'completed',
      after_sales_status: 'pending',
      after_sales_reason: '重复点击驳回售后测试',
    })

    await loginAsMerchant(page, phone, password)
    await page.goto('/orders')

    await openOrderFromOrdersPageById(page, order.phone, order.id)
    await rejectAfterSalesAndConfirm(page, { doubleConfirm: true })

    await expect
      .poll(async () => getOrderById(order.id), {
        message: 'expected double reject confirmation to resolve after-sales only once',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        status: 'completed',
        after_sales_status: 'rejected',
      })

    await expect
      .poll(async () => {
        const messages = await getMessagesByOrder(order.id)
        return messages.filter((message) => message.msg_type === 'after_sales_closed').length
      }, {
        message: 'expected double reject confirmation to append only one after_sales_closed message',
        timeout: POLL_TIMEOUT_MS,
      })
      .toBe(1)
  })

  test('merchant full cancellation rolls back customer assets', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { customer, order } = await createCustomerOrder(merchant.id, 72)
    const { coupon, userCoupon } = await createUsedCouponForCustomerAsMerchant({
      merchantId: merchant.id,
      merchantPhone: phone,
      merchantPassword: password,
      customerId: customer.id,
      amount: 8,
    })

    await updateOrder(order.id, {
      original_amount: 80,
      coupon_discount_amount: 8,
      coupon_ids: [coupon.id],
    })

    await loginAsMerchant(page, phone, password)
    await page.goto('/orders')

    await openOrderFromOrdersPageById(page, order.phone, order.id)
    await cancelOrderAndConfirm(page)

    await expect
      .poll(async () => getOrderById(order.id), {
        message: 'expected merchant cancellation to fully cancel and refund the order',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        status: 'cancelled',
        is_coupon_refunded: true,
      })

    const cancelledOrder = await getOrderById(order.id)
    expect(Number(cancelledOrder.refund_amount)).toBe(72)
    expect(Number(cancelledOrder.penalty_rate)).toBe(0)

    await expect
      .poll(async () => getCustomerById(customer.id), {
        message: 'expected merchant full cancellation to reset customer order stats',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        order_count: 0,
        points: 0,
      })

    const customerAfterCancel = await getCustomerById(customer.id)
    expect(Number(customerAfterCancel.total_spent)).toBe(0)

    await expect
      .poll(async () => getUserCouponById(userCoupon.id), {
        message: 'expected used coupon to be returned after merchant full cancellation',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        status: 'unused',
      })
  })

  test('double confirming merchant cancellation only rolls back customer assets once', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { customer, order } = await createCustomerOrder(merchant.id, 72)
    const { coupon, userCoupon } = await createUsedCouponForCustomerAsMerchant({
      merchantId: merchant.id,
      merchantPhone: phone,
      merchantPassword: password,
      customerId: customer.id,
      amount: 8,
    })

    await updateOrder(order.id, {
      original_amount: 80,
      coupon_discount_amount: 8,
      coupon_ids: [coupon.id],
    })

    await loginAsMerchant(page, phone, password)
    await page.goto('/orders')

    await openOrderFromOrdersPageById(page, order.phone, order.id)
    await cancelOrderAndConfirm(page, { doubleConfirm: true })

    await expect
      .poll(async () => getOrderById(order.id), {
        message: 'expected double confirm merchant cancellation to settle the order once',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        status: 'cancelled',
        is_coupon_refunded: true,
      })

    const cancelledOrder = await getOrderById(order.id)
    expect(Number(cancelledOrder.refund_amount)).toBe(72)
    expect(Number(cancelledOrder.penalty_rate)).toBe(0)

    await expect
      .poll(async () => getCustomerById(customer.id), {
        message: 'expected double confirm merchant cancellation to rollback customer assets once',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        order_count: 0,
        points: 0,
      })

    const customerAfterCancel = await getCustomerById(customer.id)
    expect(Number(customerAfterCancel.total_spent)).toBe(0)

    await expect
      .poll(async () => getUserCouponById(userCoupon.id), {
        message: 'expected coupon to be returned only once after double confirm merchant cancellation',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        status: 'unused',
      })
  })

  test('completed order can submit after-sales request from customer page', async ({ page }) => {
    const { merchant } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id, 54)

    await updateOrder(order.id, {
      status: 'completed',
      after_sales_status: 'none',
    })

    await page.goto(`/m/${merchant.id}/order/${order.id}`)
    await page.getByRole('button', { name: '对菜品不满意？申请售后' }).click()
    await page.getByRole('button', { name: '有异物' }).click()
    await page.getByRole('button', { name: '提交售后申请' }).click()

    await expect
      .poll(async () => getOrderById(order.id), {
        message: 'expected completed order to enter after-sales pending after customer submission',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        status: 'completed',
        after_sales_status: 'pending',
      })
  })
})

