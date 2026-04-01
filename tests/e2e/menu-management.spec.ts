import { expect, test } from '@playwright/test'

import { loginAsMerchant as loginAsMerchantHelper } from './helpers/auth'
import {
  createCategoryForMerchant,
  createMenuItemForMerchant,
  createMerchantAccount,
  getCategoryByNameAsMerchant,
  getMenuItemByIdAsMerchant,
  getMenuItemByNameAsMerchant,
} from './helpers/supabase'

async function loginAsMerchant(page: import('@playwright/test').Page, phone: string, password: string) {
  await loginAsMerchantHelper(page, { phone, password, gotoPath: '/menu' })
}

async function openMenuPage(page: import('@playwright/test').Page) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (!page.url().includes('/menu')) {
      await page.goto('/menu', { waitUntil: 'domcontentloaded' })
    }

    const managerButton = page.getByTestId('menu-category-manager-open')
    if (await managerButton.count()) {
      await expect(managerButton).toBeVisible()
      return
    }

    await page.waitForTimeout(1_000 * (attempt + 1))
  }

  throw new Error('menu page did not become ready')
}

test.describe('menu management', () => {
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(60_000)

  test('merchant can create a category from the category manager', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const categoryName = `E2E鍒嗙被${Date.now().toString().slice(-6)}`

    await loginAsMerchant(page, phone, password)
    await openMenuPage(page)

    await page.getByTestId('menu-category-manager-open').click()
    await page.getByTestId('menu-category-create').click()
    await page.getByTestId('menu-category-name-input').fill(categoryName)
    await page.getByTestId('menu-category-save').click()

    await expect.poll(async () => {
      const category = await getCategoryByNameAsMerchant({
        merchantId: merchant.id,
        categoryName,
        merchantPhone: phone,
        merchantPassword: password,
      })

      return category.name
    }, { timeout: 10_000 }).toBe(categoryName)
  })

  test('merchant can toggle menu item availability from the list', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { menuItem } = await createMenuItemForMerchant({
      merchantId: merchant.id,
      merchantPhone: phone,
      merchantPassword: password,
      itemName: `E2E鑿滃搧${Date.now().toString().slice(-6)}`,
    })

    await loginAsMerchant(page, phone, password)
    await openMenuPage(page)

    const toggle = page.getByTestId(`menu-item-toggle-${menuItem.id}`)
    await expect(toggle).toBeVisible()
    await toggle.click()

    await expect.poll(async () => {
      const latestItem = await getMenuItemByIdAsMerchant({
        menuItemId: menuItem.id,
        merchantPhone: phone,
        merchantPassword: password,
      })

      return latestItem.is_available
    }, { timeout: 10_000 }).toBe(false)
  })

  test('merchant can create a menu item with uploaded image', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const category = await createCategoryForMerchant({
      merchantId: merchant.id,
      merchantPhone: phone,
      merchantPassword: password,
      categoryName: `E2E涓婁紶鍒嗙被${Date.now().toString().slice(-6)}`,
    })
    const itemName = `E2E涓婁紶鑿滃搧${Date.now().toString().slice(-6)}`
    const imageFile = 'C:\\Users\\admin\\.gemini\\antigravity\\scratch\\online-menu\\public\\file.svg'

    await loginAsMerchant(page, phone, password)
    await openMenuPage(page)

    await page.getByRole('button', { name: category.name }).click()
    await page.getByTestId('menu-add-item-button').click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    await dialog.locator('input[type="file"]').setInputFiles(imageFile)
    await dialog.getByPlaceholder('菜品名称 *').fill(itemName)
    await dialog.locator('input[type="number"]').fill('19')
    await dialog.getByRole('button', { name: '发布并保存菜品' }).click()
    await expect(dialog).toHaveCount(0)

    await expect.poll(async () => {
      const latestItem = await getMenuItemByNameAsMerchant({
        merchantId: merchant.id,
        itemName,
        merchantPhone: phone,
        merchantPassword: password,
      })

      return {
        name: latestItem.name,
        categoryId: latestItem.category_id,
        imageUrl: latestItem.image_url ?? null,
      }
    }, { timeout: 10_000 }).toEqual({
      name: itemName,
      categoryId: category.id,
      imageUrl: expect.stringContaining('/storage/v1/object/public/menu-images/'),
    })
  })

  test('invalid menu image type is blocked before upload starts', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const category = await createCategoryForMerchant({
      merchantId: merchant.id,
      merchantPhone: phone,
      merchantPassword: password,
      categoryName: `E2E图片校验分类${Date.now().toString().slice(-6)}`,
    })
    const itemName = `E2E非法图片商品${Date.now().toString().slice(-6)}`
    const invalidFile = 'C:\\Users\\admin\\.gemini\\antigravity\\scratch\\online-menu\\README.md'
    let uploadRequestCount = 0

    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/storage/v1/object/menu-images/')) {
        uploadRequestCount += 1
      }
    })

    await loginAsMerchant(page, phone, password)
    await openMenuPage(page)

    await page.getByRole('button', { name: category.name }).click()
    await page.getByTestId('menu-add-item-button').click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    await dialog.getByTestId('menu-item-image-input').setInputFiles(invalidFile)
    await dialog.getByTestId('menu-item-name-input').fill(itemName)
    await dialog.locator('input[type="number"]').fill('25')
    await dialog.getByTestId('menu-item-save-button').click()

    await expect.poll(() => uploadRequestCount, { timeout: 5_000 }).toBe(0)
    await expect.poll(async () => {
      const latestItem = await getMenuItemByNameAsMerchant({
        merchantId: merchant.id,
        itemName,
        merchantPhone: phone,
        merchantPassword: password,
      }).catch(() => null)

      return latestItem?.id ?? null
    }, { timeout: 5_000 }).toBeNull()
  })

  test('failed menu image upload blocks creation and a valid retry still succeeds', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const category = await createCategoryForMerchant({
      merchantId: merchant.id,
      merchantPhone: phone,
      merchantPassword: password,
      categoryName: `E2E上传失败分类${Date.now().toString().slice(-6)}`,
    })
    const itemName = `E2E上传失败重试商品${Date.now().toString().slice(-6)}`
    const imageFile = 'C:\\Users\\admin\\.gemini\\antigravity\\scratch\\online-menu\\public\\file.svg'
    let failNextUpload = true

    await page.route('**/storage/v1/object/menu-images/**', async (route) => {
      if (failNextUpload) {
        failNextUpload = false
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'forced upload failure' }),
        })
        return
      }

      await route.fallback()
    })

    await loginAsMerchant(page, phone, password)
    await openMenuPage(page)

    await page.getByRole('button', { name: category.name }).click()
    await page.getByTestId('menu-add-item-button').click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    await dialog.getByTestId('menu-item-image-input').setInputFiles(imageFile)
    await dialog.getByTestId('menu-item-name-input').fill(itemName)
    await dialog.locator('input[type="number"]').fill('29')
    await dialog.getByTestId('menu-item-save-button').click()

    await expect(dialog).toBeVisible()
    await expect.poll(async () => {
      const latestItem = await getMenuItemByNameAsMerchant({
        merchantId: merchant.id,
        itemName,
        merchantPhone: phone,
        merchantPassword: password,
      }).catch(() => null)

      return latestItem?.id ?? null
    }, { timeout: 5_000 }).toBeNull()

    await dialog.getByTestId('menu-item-image-input').setInputFiles(imageFile)
    await dialog.getByTestId('menu-item-save-button').click()
    await expect(dialog).toHaveCount(0)

    await expect.poll(async () => {
      const latestItem = await getMenuItemByNameAsMerchant({
        merchantId: merchant.id,
        itemName,
        merchantPhone: phone,
        merchantPassword: password,
      })

      return latestItem.image_url ?? null
    }, { timeout: 15_000 }).toEqual(expect.stringContaining('/storage/v1/object/public/menu-images/'))
  })

  test('merchant can edit an existing menu item name and price and the storefront reflects it', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { menuItem } = await createMenuItemForMerchant({
      merchantId: merchant.id,
      merchantPhone: phone,
      merchantPassword: password,
      itemName: `E2E鍘熷鑿滃搧${Date.now().toString().slice(-6)}`,
      price: 18,
    })
    const updatedName = `E2E鏂拌彍鍝?${Date.now().toString().slice(-6)}`
    const imageFile = 'C:\\Users\\admin\\.gemini\\antigravity\\scratch\\online-menu\\public\\file.svg'

    await loginAsMerchant(page, phone, password)
    await openMenuPage(page)

    await page.getByTestId(`menu-item-edit-${menuItem.id}`).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    await dialog.getByTestId('menu-item-image-input').setInputFiles(imageFile)
    await dialog.getByTestId('menu-item-name-input').fill(updatedName)
    await dialog.getByTestId('menu-item-price-input').fill('33')
    await dialog.getByTestId('menu-item-save-button').click()

    await expect.poll(async () => {
      const latestItem = await getMenuItemByIdAsMerchant({
        menuItemId: menuItem.id,
        merchantPhone: phone,
        merchantPassword: password,
      })

      return {
        name: latestItem.name,
        price: latestItem.price,
      }
    }, { timeout: 10_000 }).toEqual({
      name: updatedName,
      price: 33,
    })

    await page.goto(`/m/${merchant.id}`)
    await expect(page.getByTestId(`menu-item-${menuItem.id}`)).toContainText(updatedName)
    await expect(page.getByTestId(`menu-item-${menuItem.id}`)).toContainText('33')
  })

  test('merchant can replace an existing menu item image and storefront still shows the item', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const category = await createCategoryForMerchant({
      merchantId: merchant.id,
      merchantPhone: phone,
      merchantPassword: password,
      categoryName: `E2E Image Replace Category ${Date.now().toString().slice(-6)}`,
    })
    const itemName = `E2E Image Replace Item ${Date.now().toString().slice(-6)}`
    const imageFile = 'C:\\Users\\admin\\.gemini\\antigravity\\scratch\\online-menu\\public\\file.svg'

    await loginAsMerchant(page, phone, password)
    await openMenuPage(page)

    await page.getByRole('button', { name: category.name }).click()
    await page.getByTestId('menu-add-item-button').click()

    let dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByTestId('menu-item-image-input').setInputFiles(imageFile)
    await dialog.getByTestId('menu-item-name-input').fill(itemName)
    await dialog.getByTestId('menu-item-price-input').fill('27')
    await dialog.getByTestId('menu-item-save-button').click()
    await expect(dialog).toHaveCount(0)

    const createdItem = await getMenuItemByNameAsMerchant({
      merchantId: merchant.id,
      itemName,
      merchantPhone: phone,
      merchantPassword: password,
    })
    const originalImageUrl = createdItem.image_url

    await page.getByTestId(`menu-item-edit-${createdItem.id}`).click()
    dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByTestId('menu-item-image-input').setInputFiles(imageFile)
    await dialog.getByTestId('menu-item-save-button').click()

    await expect.poll(async () => {
      const latestItem = await getMenuItemByIdAsMerchant({
        menuItemId: createdItem.id,
        merchantPhone: phone,
        merchantPassword: password,
      })
      return latestItem.image_url ?? null
    }, { timeout: 15_000 }).toEqual(expect.not.stringMatching(`^${originalImageUrl}$`))

    await page.goto(`/m/${merchant.id}`)
    await expect(page.getByTestId(`menu-item-${createdItem.id}`)).toBeVisible()
  })

  test('merchant can re-enable a menu item and the storefront shows it again', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { menuItem } = await createMenuItemForMerchant({
      merchantId: merchant.id,
      merchantPhone: phone,
      merchantPassword: password,
      itemName: `E2E Reenable Item ${Date.now().toString().slice(-6)}`,
      price: 21,
    })

    await loginAsMerchant(page, phone, password)
    await openMenuPage(page)

    const toggle = page.getByTestId(`menu-item-toggle-${menuItem.id}`)
    await toggle.click()
    await expect.poll(async () => {
      const latestItem = await getMenuItemByIdAsMerchant({
        menuItemId: menuItem.id,
        merchantPhone: phone,
        merchantPassword: password,
      })
      return latestItem.is_available
    }, { timeout: 10_000 }).toBe(false)

    await page.goto(`/m/${merchant.id}`)
    await expect(page.getByTestId(`menu-item-${menuItem.id}`)).toHaveCount(0)

    await page.goto('/menu', { waitUntil: 'domcontentloaded' })
    await openMenuPage(page)
    await page.getByTestId(`menu-item-toggle-${menuItem.id}`).click()

    await expect.poll(async () => {
      const latestItem = await getMenuItemByIdAsMerchant({
        menuItemId: menuItem.id,
        merchantPhone: phone,
        merchantPassword: password,
      })
      return latestItem.is_available
    }, { timeout: 10_000 }).toBe(true)

    await page.goto(`/m/${merchant.id}`)
    await expect(page.getByTestId(`menu-item-${menuItem.id}`)).toBeVisible()
  })

  test('merchant can rename a category and the storefront reflects the new label', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { category } = await createMenuItemForMerchant({
      merchantId: merchant.id,
      merchantPhone: phone,
      merchantPassword: password,
      categoryName: `E2E Original Category ${Date.now().toString().slice(-6)}`,
      itemName: `E2E Category Item ${Date.now().toString().slice(-4)}`,
    })
    const updatedCategoryName = `E2E Updated Category ${Date.now().toString().slice(-6)}`

    await loginAsMerchant(page, phone, password)
    await openMenuPage(page)

    await page.getByTestId('menu-category-manager-open').click()
    await page.getByTestId(`menu-category-edit-${category.id}`).click()
    await page.getByTestId('menu-category-name-input').clear()
    await page.getByTestId('menu-category-name-input').fill(updatedCategoryName)
    await page.getByTestId('menu-category-save').click()

    await expect.poll(async () => {
      const latestCategory = await getCategoryByNameAsMerchant({
        merchantId: merchant.id,
        categoryName: updatedCategoryName,
        merchantPhone: phone,
        merchantPassword: password,
      })

      return latestCategory.name
    }, { timeout: 10_000 }).toBe(updatedCategoryName)

    await page.goto(`/m/${merchant.id}`)
    await expect(page.getByText(updatedCategoryName).first()).toBeVisible()
  })
})
