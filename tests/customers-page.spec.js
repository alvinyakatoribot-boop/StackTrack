const { test, expect } = require('@playwright/test');

const BASE_SETTINGS = {
  shopName: 'Test Bullion Shop',
  sellPremCoins: 7, sellPremBars: 5, sellPremScrap: 3,
  buyDiscCoins: 3, buyDiscBars: 5, buyDiscScrap: 8,
  whDiscCoins: 1, whDiscBars: 2, whDiscScrap: 3,
  coinAdjustments: { eagles: 0, maples: 0, krugerrands: 0, britannias: 0, philharmonics: 0 },
  junkDivisor: 1.3, junkMultOverride: null,
  threshGold: 10, threshSilver: 500,
};

const CUSTOMERS = [
  { id: 'cust-a', name: 'Alice Gold', email: 'alice@example.com', phone: '555-1111', w9OnFile: true },
  { id: 'cust-b', name: 'Bob Silver', email: 'bob@example.com', phone: '555-2222', w9OnFile: false },
  { id: 'cust-c', name: 'Charlie Bronze', email: 'charlie@example.com', phone: '555-3333', w9OnFile: true },
];

const TRANSACTIONS = [
  {
    id: 'tx-1', date: '2025-01-15T12:00:00Z', type: 'buy', metal: 'gold', form: 'bars', coinType: null,
    qty: 5, spot: 2500, price: 2375, total: 11875, profit: 625,
    payment: 'cash', customerId: 'cust-a', form8300Flag: true,
  },
  {
    id: 'tx-2', date: '2025-01-16T12:00:00Z', type: 'sell', metal: 'silver', form: 'rounds', coinType: null,
    qty: 100, spot: 32, price: 33.6, total: 3360, profit: 160,
    payment: 'wire', customerId: 'cust-b',
  },
  {
    id: 'tx-3', date: '2025-01-17T12:00:00Z', type: 'wholesale', metal: 'gold', form: 'coins', coinType: 'eagles',
    qty: 10, spot: 2500, price: 2475, total: 24750, profit: 250,
    payment: 'wire', customerId: 'cust-a',
  },
  {
    id: 'tx-4', date: '2025-01-18T12:00:00Z', type: 'buy', metal: 'silver', form: 'junk', coinType: null,
    qty: 26, spot: 32, price: 24, total: 624, profit: 32,
    payment: 'cash', customerId: 'cust-b', form1099BFlag: true,
  },
  {
    id: 'tx-5', date: '2025-01-19T12:00:00Z', type: 'buy', metal: 'gold', form: 'bars', coinType: null,
    qty: 35, spot: 2500, price: 2375, total: 83125, profit: 4375,
    payment: 'wire', customerId: 'cust-a', form1099BFlag: true, form8300Flag: true,
  },
];

async function mockSpotPrices(page, { gold = 2500, silver = 32 } = {}) {
  await page.route('**/api.gold-api.com/price/XAU', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ price: gold }) }),
  );
  await page.route('**/api.gold-api.com/price/XAG', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ price: silver }) }),
  );
}

async function seedAndReload(page, data) {
  await page.evaluate((d) => {
    localStorage.setItem('st_settings', JSON.stringify(d.settings));
    localStorage.setItem('st_transactions', JSON.stringify(d.transactions));
    localStorage.setItem('st_customers', JSON.stringify(d.customers));
    localStorage.setItem('st_contacts', JSON.stringify(d.contacts));
  }, data);
  await page.reload();
  await page.waitForFunction(() => {
    const el = document.getElementById('outSpot');
    return el && !el.textContent.includes('$0.00');
  }, { timeout: 5000 });
}

const SEED_DATA = {
  settings: BASE_SETTINGS,
  transactions: TRANSACTIONS,
  customers: CUSTOMERS,
  contacts: [],
};

async function navigateToCustomers(page) {
  await page.locator('.nav-item[data-page="customers"]').click();
  await expect(page.locator('#page-customers')).toHaveClass(/active/);
}

test.describe('Customers Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await mockSpotPrices(page);
    await seedAndReload(page, SEED_DATA);
  });

  test('page accessible via nav tab', async ({ page }) => {
    const navItem = page.locator('.nav-item[data-page="customers"]');
    await expect(navItem).toBeVisible();
    await expect(navItem).toHaveText('Customers');
    await navItem.click();
    await expect(page.locator('#page-customers')).toHaveClass(/active/);
  });

  test('shows all customers in directory', async ({ page }) => {
    await navigateToCustomers(page);
    const rows = page.locator('.customer-row');
    await expect(rows).toHaveCount(3);
  });

  test('empty state when no customers', async ({ page }) => {
    await seedAndReload(page, { ...SEED_DATA, customers: [] });
    await navigateToCustomers(page);
    await expect(page.locator('#customersEmpty')).toBeVisible();
    await expect(page.locator('#customersEmpty')).toContainText('No customers yet');
  });

  test('search filters by name', async ({ page }) => {
    await navigateToCustomers(page);
    await page.fill('#customersSearchInput', 'Alice');
    const rows = page.locator('.customer-row');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Alice Gold');
  });

  test('search filters by phone', async ({ page }) => {
    await navigateToCustomers(page);
    await page.fill('#customersSearchInput', '555-2222');
    const rows = page.locator('.customer-row');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Bob Silver');
  });

  test('click row opens customer profile overlay', async ({ page }) => {
    await navigateToCustomers(page);
    await page.locator('.customer-row').first().click();
    await expect(page.locator('#customerProfileOverlay')).toHaveClass(/open/);
  });

  test('W-9 badge displays correctly — green for on-file', async ({ page }) => {
    await navigateToCustomers(page);
    // Alice has w9OnFile: true — she should be first alphabetically
    const aliceRow = page.locator('.customer-row', { hasText: 'Alice Gold' });
    const badge = aliceRow.locator('.w9-badge');
    await expect(badge).toHaveText('On File');
    await expect(badge).toHaveClass(/on-file/);
  });

  test('W-9 badge displays correctly — orange for missing', async ({ page }) => {
    await navigateToCustomers(page);
    const bobRow = page.locator('.customer-row', { hasText: 'Bob Silver' });
    const badge = bobRow.locator('.w9-badge');
    await expect(badge).toHaveText('Missing');
    await expect(badge).toHaveClass(/missing/);
  });

  test('transaction count shown per customer', async ({ page }) => {
    await navigateToCustomers(page);
    // Alice has tx-1, tx-3, tx-5 = 3 transactions
    const aliceRow = page.locator('.customer-row', { hasText: 'Alice Gold' });
    const cells = aliceRow.locator('td');
    await expect(cells.nth(3)).toHaveText('3');
    // Bob has tx-2, tx-4 = 2 transactions
    const bobRow = page.locator('.customer-row', { hasText: 'Bob Silver' });
    const bobCells = bobRow.locator('td');
    await expect(bobCells.nth(3)).toHaveText('2');
  });

  test('total volume shown per customer', async ({ page }) => {
    await navigateToCustomers(page);
    // Alice total: 11875 + 24750 + 83125 = $119,750.00
    const aliceRow = page.locator('.customer-row', { hasText: 'Alice Gold' });
    const cells = aliceRow.locator('td');
    await expect(cells.nth(4)).toContainText('$119,750.00');
  });

  test('Add Customer button opens modal', async ({ page }) => {
    await navigateToCustomers(page);
    await page.click('#customersAddBtn');
    await expect(page.locator('#addCustomerModal')).toHaveClass(/open/);
  });

  test('new customer appears in list after adding', async ({ page }) => {
    await navigateToCustomers(page);
    await page.click('#customersAddBtn');
    await page.fill('#newCustomerName', 'Diana Platinum');
    await page.fill('#newCustomerPhone', '555-4444');
    await page.click('#addCustomerSaveBtn');
    // Navigate back to customers page
    await navigateToCustomers(page);
    const rows = page.locator('.customer-row');
    await expect(rows).toHaveCount(4);
    await expect(page.locator('.customer-row', { hasText: 'Diana Platinum' })).toBeVisible();
  });

  test('compliance flag counts shown per customer', async ({ page }) => {
    await navigateToCustomers(page);
    // Alice: 2x 8300 flags (tx-1, tx-5), 1x 1099-B (tx-5)
    const aliceRow = page.locator('.customer-row', { hasText: 'Alice Gold' });
    const aliceCells = aliceRow.locator('td');
    await expect(aliceCells.nth(5)).toHaveText('2');
    await expect(aliceCells.nth(6)).toHaveText('1');
    // Bob: 0x 8300 flags, 1x 1099-B (tx-4)
    const bobRow = page.locator('.customer-row', { hasText: 'Bob Silver' });
    const bobCells = bobRow.locator('td');
    await expect(bobCells.nth(5)).toHaveText('0');
    await expect(bobCells.nth(6)).toHaveText('1');
  });

  test('customer list sorted alphabetically', async ({ page }) => {
    await navigateToCustomers(page);
    const rows = page.locator('.customer-row');
    await expect(rows.nth(0)).toContainText('Alice Gold');
    await expect(rows.nth(1)).toContainText('Bob Silver');
    await expect(rows.nth(2)).toContainText('Charlie Bronze');
  });
});
