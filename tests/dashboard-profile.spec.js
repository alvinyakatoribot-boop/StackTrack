const { test, expect } = require('@playwright/test');

const BASE_SETTINGS = {
  shopName: 'Test Bullion Shop',
  sellPremCoins: 7, sellPremBars: 5, sellPremScrap: 3,
  buyDiscCoins: 3, buyDiscBars: 5, buyDiscScrap: 8,
  whDiscCoins: 1, whDiscBars: 2, whDiscScrap: 3,
  coinAdjustments: { eagles: 0, maples: 0, krugerrands: 0, britannias: 0, philharmonics: 0 },
  junkMultiplier: 0.715, junkMultOverride: null,
  sellPremJunk: 7, buyDiscJunk: 3, whDiscJunk: 1,
  threshGold: 10, threshSilver: 500,
};

const TODAY = new Date().toISOString();
const OLD_DATE = '2024-06-15T12:00:00Z';

const CUSTOMERS = [
  { id: 'cust-1', name: 'Alice Gold', email: 'alice@example.com', phone: '555-1111', w9OnFile: true },
  { id: 'cust-2', name: 'Bob Silver', email: 'bob@example.com', phone: '', w9OnFile: false },
];

// Mix of transactions: some today, some old, buys/sells/wholesale, cash/wire, with flags
const TRANSACTIONS = [
  // Today's transactions
  {
    id: 'tx-1', date: TODAY, type: 'buy', metal: 'gold', form: 'bars', coinType: null,
    qty: 5, spot: 2500, price: 2375, total: 11875, profit: 625,
    payment: 'cash', customerId: 'cust-1', form8300Flag: true,
  },
  {
    id: 'tx-2', date: TODAY, type: 'sell', metal: 'silver', form: 'rounds', coinType: null,
    qty: 100, spot: 32, price: 33.6, total: 3360, profit: 160,
    payment: 'wire', customerId: 'cust-2',
  },
  {
    id: 'tx-3', date: TODAY, type: 'wholesale', metal: 'gold', form: 'coins', coinType: 'eagles',
    qty: 10, spot: 2500, price: 2475, total: 24750, profit: 250,
    payment: 'wire', customerId: 'cust-1',
  },
  {
    id: 'tx-4', date: TODAY, type: 'buy', metal: 'silver', form: 'junk', coinType: null,
    qty: 26, spot: 32, price: 24, total: 624, profit: 32,
    payment: 'cash', customerId: 'cust-2', form1099BFlag: true,
  },
  {
    id: 'tx-5', date: TODAY, type: 'buy', metal: 'gold', form: 'bars', coinType: null,
    qty: 35, spot: 2500, price: 2375, total: 83125, profit: 4375,
    payment: 'wire', customerId: 'cust-1', form1099BFlag: true, form8300Flag: true,
  },
  // Old transactions (should NOT count in today's KPIs)
  {
    id: 'tx-6', date: OLD_DATE, type: 'buy', metal: 'gold', form: 'coins', coinType: 'maples',
    qty: 3, spot: 2200, price: 2100, total: 6300, profit: 300,
    payment: 'cash', customerId: 'cust-1',
  },
  {
    id: 'tx-7', date: OLD_DATE, type: 'sell', metal: 'silver', form: 'bars', coinType: null,
    qty: 50, spot: 28, price: 29, total: 1450, profit: 50,
    payment: 'wire', customerId: 'cust-2',
  },
  {
    id: 'tx-8', date: OLD_DATE, type: 'buy', metal: 'silver', form: 'rounds', coinType: null,
    qty: 200, spot: 28, price: 26, total: 5200, profit: 400,
    payment: 'cash', customerId: 'cust-2', form8300Flag: true, form8300Reviewed: true,
  },
];

/** Mock the gold-api.com spot price endpoints. */
async function mockSpotPrices(page, { gold = 2500, silver = 32 } = {}) {
  await page.route('**/api.gold-api.com/price/XAU', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ price: gold }) }),
  );
  await page.route('**/api.gold-api.com/price/XAG', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ price: silver }) }),
  );
}

/** Seed localStorage with given data and reload. */
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

// ─── Dashboard — Default Landing Page ───────────────────────────────

test.describe('Dashboard — Default Landing Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await mockSpotPrices(page);
    await seedAndReload(page, SEED_DATA);
  });

  test('dashboard page is active on load', async ({ page }) => {
    await expect(page.locator('#page-dashboard')).toHaveClass(/active/);
  });

  test('dashboard nav item is active on load', async ({ page }) => {
    await expect(page.locator('.nav-item[data-page="dashboard"]')).toHaveClass(/active/);
  });
});

// ─── Dashboard — KPI Cards ──────────────────────────────────────────

test.describe('Dashboard — KPI Cards', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await mockSpotPrices(page);
    await seedAndReload(page, SEED_DATA);
  });

  test('shows correct today transaction count (excludes old)', async ({ page }) => {
    // 5 today transactions (tx-1 through tx-5), 3 old ones excluded
    await expect(page.locator('#dashTxCount')).toHaveText('5');
  });

  test('shows correct today bought total', async ({ page }) => {
    // Today's buys: tx-1 ($11,875) + tx-4 ($624) + tx-5 ($83,125) = $95,624
    const text = await page.locator('#dashBought').textContent();
    expect(text).toContain('95,624');
  });

  test('shows correct today sold total (includes wholesale)', async ({ page }) => {
    // Today's sells+wholesale: tx-2 ($3,360) + tx-3 ($24,750) = $28,110
    const text = await page.locator('#dashSold').textContent();
    expect(text).toContain('28,110');
  });

  test('shows correct today profit', async ({ page }) => {
    // Today's profit: 625 + 160 + 250 + 32 + 4375 = $5,442
    const text = await page.locator('#dashProfit').textContent();
    expect(text).toContain('5,442');
  });
});

// ─── Dashboard — Inventory Snapshot ─────────────────────────────────

test.describe('Dashboard — Inventory Snapshot', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await mockSpotPrices(page, { gold: 2500, silver: 32 });
    await seedAndReload(page, SEED_DATA);
  });

  test('shows correct gold oz and spot value', async ({ page }) => {
    // Gold inventory: buy 5 bars + buy 3 maples + buy 35 bars - sell 10 eagles(wholesale) = 33 oz
    const ozText = await page.locator('#dashGoldOz').textContent();
    expect(ozText).toContain('33.000');
    const valText = await page.locator('#dashGoldVal').textContent();
    // 33 * 2500 = $82,500
    expect(valText).toContain('82,500');
  });

  test('shows correct silver oz and spot value', async ({ page }) => {
    // Silver inventory: buy 200 rounds - sell 100 rounds - sell 50 bars = 50 oz (non-junk)
    // Junk: 26 / 1.3 = 20 oz
    // Total silver = 50 + 20 = 70. Non-junk = 50
    const ozText = await page.locator('#dashSilverOz').textContent();
    expect(ozText).toContain('50.000');
    const valText = await page.locator('#dashSilverVal').textContent();
    // 50 * 32 = $1,600
    expect(valText).toContain('1,600');
  });

  test('shows correct junk silver oz and spot value', async ({ page }) => {
    // Junk: 26 FV * 0.715 multiplier = 18.59 oz
    const ozText = await page.locator('#dashJunkOz').textContent();
    expect(ozText).toContain('18.590');
    const valText = await page.locator('#dashJunkVal').textContent();
    // 18.59 * 32 = $594.88
    expect(valText).toContain('594');
  });
});

// ─── Dashboard — Compliance Action Items ────────────────────────────

test.describe('Dashboard — Compliance Action Items', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await mockSpotPrices(page);
    await seedAndReload(page, SEED_DATA);
  });

  test('shows correct unfiled 8300 count', async ({ page }) => {
    // tx-1 and tx-5 have form8300Flag=true and no form8300Reviewed
    // tx-8 has form8300Flag but also form8300Reviewed=true so excluded
    await expect(page.locator('#dashUnfiled8300')).toHaveText('2');
  });

  test('shows correct unfiled 1099-B count', async ({ page }) => {
    // tx-4 and tx-5 have form1099BFlag=true and no form1099BFiled
    await expect(page.locator('#dashUnfiled1099B')).toHaveText('2');
  });

  test('shows correct customers needing W-9 count', async ({ page }) => {
    // cust-2 (Bob Silver) has w9OnFile=false and has transactions
    await expect(page.locator('#dashNeedW9')).toHaveText('1');
  });

  test('clicking 8300 action navigates to transactions page with filter set', async ({ page }) => {
    await page.click('.compliance-action-item:has(#dashUnfiled8300)');

    // Should navigate to transactions page
    await expect(page.locator('#page-transactions')).toHaveClass(/active/);
    await expect(page.locator('.nav-item[data-page="transactions"]')).toHaveClass(/active/);

    // Filter should be set to 'needs-review'
    const filterVal = await page.locator('#filterCompliance').inputValue();
    expect(filterVal).toBe('needs-review');
  });
});

// ─── Dashboard — Recent Transactions ────────────────────────────────

test.describe('Dashboard — Recent Transactions', () => {
  test('shows last 10 transactions sorted date desc', async ({ page }) => {
    await page.goto('/');
    await mockSpotPrices(page);
    await seedAndReload(page, SEED_DATA);

    const rows = await page.locator('#dashRecentBody tr').count();
    expect(rows).toBe(8); // We have 8 total transactions
  });

  test('shows empty state when no transactions', async ({ page }) => {
    await page.goto('/');
    await mockSpotPrices(page);
    await seedAndReload(page, {
      settings: BASE_SETTINGS,
      transactions: [],
      customers: [],
      contacts: [],
    });

    await expect(page.locator('#dashRecentEmpty')).toBeVisible();
    const rows = await page.locator('#dashRecentBody tr').count();
    expect(rows).toBe(0);
  });

  test('customer names are clickable links', async ({ page }) => {
    await page.goto('/');
    await mockSpotPrices(page);
    await seedAndReload(page, SEED_DATA);

    // Find a link with customer name in the recent transactions
    const link = page.locator('#dashRecentBody a').first();
    await expect(link).toBeVisible();
    const text = await link.textContent();
    expect(['Alice Gold', 'Bob Silver']).toContain(text);
  });
});

// ─── Dashboard — Live Updates ───────────────────────────────────────

test.describe('Dashboard — Live Updates', () => {
  test('dashboard updates after logging a new deal', async ({ page }) => {
    await page.goto('/');
    await mockSpotPrices(page);
    await seedAndReload(page, SEED_DATA);

    // Check initial today count
    await expect(page.locator('#dashTxCount')).toHaveText('5');

    // Navigate to calculator, log a deal, then go back to dashboard
    await page.click('[data-page="calculator"]');
    await page.selectOption('#calcMetal', 'gold');
    await page.selectOption('#calcForm', 'bars');
    await page.fill('#calcQty', '1');
    await page.click('#logDealBtn');

    // Close receipt modal if it opens
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      document.getElementById('receiptModal').classList.remove('open');
    });

    // Return to dashboard
    await page.click('[data-page="dashboard"]');

    // Should now show 6 today transactions
    await expect(page.locator('#dashTxCount')).toHaveText('6');
  });
});

// ─── Customer Profile — Open/Close ──────────────────────────────────

test.describe('Customer Profile — Open/Close', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await mockSpotPrices(page);
    await seedAndReload(page, SEED_DATA);
  });

  test('clicking customer name in transactions table opens profile', async ({ page }) => {
    await page.click('[data-page="transactions"]');
    const link = page.locator('#txBody a').first();
    await link.click();
    await expect(page.locator('#customerProfileOverlay')).toHaveClass(/open/);
  });

  test('close button closes profile', async ({ page }) => {
    await page.click('[data-page="transactions"]');
    await page.locator('#txBody a').first().click();
    await expect(page.locator('#customerProfileOverlay')).toHaveClass(/open/);

    await page.click('#cpCloseBtn');
    await expect(page.locator('#customerProfileOverlay')).not.toHaveClass(/open/);
  });

  test('overlay backdrop click closes profile', async ({ page }) => {
    await page.click('[data-page="transactions"]');
    await page.locator('#txBody a').first().click();
    await expect(page.locator('#customerProfileOverlay')).toHaveClass(/open/);

    // Click on the overlay itself (not the modal inside it)
    await page.locator('#customerProfileOverlay').click({ position: { x: 5, y: 5 } });
    await expect(page.locator('#customerProfileOverlay')).not.toHaveClass(/open/);
  });

  test('escape key closes profile', async ({ page }) => {
    await page.click('[data-page="transactions"]');
    await page.locator('#txBody a').first().click();
    await expect(page.locator('#customerProfileOverlay')).toHaveClass(/open/);

    await page.keyboard.press('Escape');
    await expect(page.locator('#customerProfileOverlay')).not.toHaveClass(/open/);
  });
});

// ─── Customer Profile — Stats & Data ────────────────────────────────

test.describe('Customer Profile — Stats & Data', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await mockSpotPrices(page);
    await seedAndReload(page, SEED_DATA);
  });

  test('shows correct transaction count for customer', async ({ page }) => {
    // Open Alice Gold's profile — she has 4 transactions (tx-1, tx-3, tx-5, tx-6)
    await page.evaluate(() => openCustomerProfile('cust-1'));
    await expect(page.locator('#customerProfileOverlay')).toHaveClass(/open/);
    await expect(page.locator('#cpTotalTx')).toHaveText('4');
  });

  test('shows correct bought/sold/P&L stats', async ({ page }) => {
    // Alice (cust-1): buys = tx-1 ($11,875) + tx-5 ($83,125) + tx-6 ($6,300) = $101,300
    // sells/wholesale = tx-3 ($24,750)
    // profit = 625 + 250 + 4375 + 300 = $5,550
    await page.evaluate(() => openCustomerProfile('cust-1'));

    const bought = await page.locator('#cpTotalBought').textContent();
    expect(bought).toContain('101,300');

    const sold = await page.locator('#cpTotalSold').textContent();
    expect(sold).toContain('24,750');

    const pnl = await page.locator('#cpNetPnl').textContent();
    expect(pnl).toContain('5,550');
  });

  test('shows compliance flag counts and W-9 status', async ({ page }) => {
    // Alice (cust-1): 2x form8300Flag (tx-1, tx-5), 1x form1099BFlag (tx-5), w9OnFile=true
    await page.evaluate(() => openCustomerProfile('cust-1'));

    const compHtml = await page.locator('#cpCompliance').innerHTML();
    expect(compHtml).toContain('2');           // 8300 count
    expect(compHtml).toContain('Form 8300');
    expect(compHtml).toContain('1');           // 1099-B count
    expect(compHtml).toContain('1099-B');
    expect(compHtml).toContain('W-9 On File');
  });

  test('shows transaction history for the customer', async ({ page }) => {
    await page.evaluate(() => openCustomerProfile('cust-1'));

    // Should have 4 rows in the profile transaction table
    const rows = await page.locator('#cpTxBody tr').count();
    expect(rows).toBe(4);
  });
});

// ─── Customer Profile — Edit & Save ─────────────────────────────────

test.describe('Customer Profile — Edit & Save', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await mockSpotPrices(page);
    await seedAndReload(page, SEED_DATA);
    await page.evaluate(() => openCustomerProfile('cust-2'));
    await expect(page.locator('#customerProfileOverlay')).toHaveClass(/open/);
  });

  test('can edit phone, notes, W-9 and save', async ({ page }) => {
    await page.fill('#cpPhone', '555-9999');
    await page.fill('#cpNotes', 'VIP customer');
    await page.check('#cpW9');
    await page.click('#cpSaveBtn');

    const customer = await page.evaluate(() => {
      const custs = JSON.parse(localStorage.getItem('st_customers'));
      return custs.find(c => c.id === 'cust-2');
    });
    expect(customer.phone).toBe('555-9999');
    expect(customer.notes).toBe('VIP customer');
    expect(customer.w9OnFile).toBe(true);
  });

  test('saved changes persist in localStorage', async ({ page }) => {
    await page.fill('#cpPhone', '555-4321');
    await page.click('#cpSaveBtn');

    // Reload page and check localStorage directly
    await page.reload();
    const customer = await page.evaluate(() => {
      const custs = JSON.parse(localStorage.getItem('st_customers'));
      return custs.find(c => c.id === 'cust-2');
    });
    expect(customer.phone).toBe('555-4321');
  });

  test('profile refreshes after save', async ({ page }) => {
    // Bob has w9OnFile=false, compliance should show "No W-9"
    const compBefore = await page.locator('#cpCompliance').innerHTML();
    expect(compBefore).toContain('No W-9');

    // Check W-9 and save
    await page.check('#cpW9');
    await page.click('#cpSaveBtn');

    // After save, profile is refreshed — now should show "W-9 On File"
    const compAfter = await page.locator('#cpCompliance').innerHTML();
    expect(compAfter).toContain('W-9 On File');
  });
});

// ─── Customer Profile — Clickable Names ─────────────────────────────

test.describe('Customer Profile — Clickable Names', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await mockSpotPrices(page);
    await seedAndReload(page, SEED_DATA);
  });

  test('customer name in dashboard recent table opens profile', async ({ page }) => {
    const link = page.locator('#dashRecentBody a').first();
    await link.click();
    await expect(page.locator('#customerProfileOverlay')).toHaveClass(/open/);
    // Verify the profile shows a customer name
    const name = await page.locator('#cpName').textContent();
    expect(['Alice Gold', 'Bob Silver']).toContain(name);
  });

  test('customer name in main transactions table opens profile', async ({ page }) => {
    await page.click('[data-page="transactions"]');
    const link = page.locator('#txBody a').first();
    await link.click();
    await expect(page.locator('#customerProfileOverlay')).toHaveClass(/open/);
    const name = await page.locator('#cpName').textContent();
    expect(['Alice Gold', 'Bob Silver']).toContain(name);
  });
});
