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

// ─── Core Rules Engine ──────────────────────────────────────────────

test.describe('1099-B — Rules Engine', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await mockSpotPrices(page);
    await seedAndReload(page, {
      settings: BASE_SETTINGS,
      transactions: [],
      customers: [],
      contacts: [],
    });
  });

  test('is1099BReportableProduct returns true for gold bars', async ({ page }) => {
    const result = await page.evaluate(() => is1099BReportableProduct('gold', 'bars', null));
    expect(result).toBe(true);
  });

  test('is1099BReportableProduct returns true for silver rounds', async ({ page }) => {
    const result = await page.evaluate(() => is1099BReportableProduct('silver', 'rounds', null));
    expect(result).toBe(true);
  });

  test('is1099BReportableProduct returns true for gold Maple Leafs', async ({ page }) => {
    const result = await page.evaluate(() => is1099BReportableProduct('gold', 'coins', 'maples'));
    expect(result).toBe(true);
  });

  test('is1099BReportableProduct returns true for gold Krugerrands', async ({ page }) => {
    const result = await page.evaluate(() => is1099BReportableProduct('gold', 'coins', 'krugerrands'));
    expect(result).toBe(true);
  });

  test('is1099BReportableProduct returns true for junk silver', async ({ page }) => {
    const result = await page.evaluate(() => is1099BReportableProduct('silver', 'junk', null));
    expect(result).toBe(true);
  });

  test('is1099BReportableProduct returns false for American Eagles', async ({ page }) => {
    const result = await page.evaluate(() => is1099BReportableProduct('gold', 'coins', 'eagles'));
    expect(result).toBe(false);
  });

  test('is1099BReportableProduct returns false for Britannias', async ({ page }) => {
    const result = await page.evaluate(() => is1099BReportableProduct('gold', 'coins', 'britannias'));
    expect(result).toBe(false);
  });

  test('is1099BReportableProduct returns false for Philharmonics', async ({ page }) => {
    const result = await page.evaluate(() => is1099BReportableProduct('gold', 'coins', 'philharmonics'));
    expect(result).toBe(false);
  });

  test('is1099BReportableProduct returns false for scrap', async ({ page }) => {
    const result = await page.evaluate(() => is1099BReportableProduct('gold', 'scrap', null));
    expect(result).toBe(false);
  });

  test('get1099BThreshold returns 32.15 for gold bars', async ({ page }) => {
    const result = await page.evaluate(() => get1099BThreshold('gold', 'bars', null));
    expect(result).toBe(32.15);
  });

  test('get1099BThreshold returns 1000 for silver bars', async ({ page }) => {
    const result = await page.evaluate(() => get1099BThreshold('silver', 'bars', null));
    expect(result).toBe(1000);
  });

  test('get1099BThreshold returns 25 for Maple Leafs', async ({ page }) => {
    const result = await page.evaluate(() => get1099BThreshold('gold', 'coins', 'maples'));
    expect(result).toBe(25);
  });

  test('get1099BThreshold returns 1000 for junk silver', async ({ page }) => {
    const result = await page.evaluate(() => get1099BThreshold('silver', 'junk', null));
    expect(result).toBe(1000);
  });

  test('check1099B returns reportable for single buy exceeding threshold', async ({ page }) => {
    const result = await page.evaluate(() => check1099B({
      type: 'buy', metal: 'gold', form: 'bars', coinType: null,
      qty: 35, customerId: null, date: new Date().toISOString(),
    }));
    expect(result.reportable).toBe(true);
    expect(result.reason).toContain('threshold');
  });

  test('check1099B returns not reportable for buy below threshold', async ({ page }) => {
    const result = await page.evaluate(() => check1099B({
      type: 'buy', metal: 'gold', form: 'bars', coinType: null,
      qty: 10, customerId: null, date: new Date().toISOString(),
    }));
    expect(result.reportable).toBe(false);
  });

  test('check1099B returns not reportable for sell transactions', async ({ page }) => {
    const result = await page.evaluate(() => check1099B({
      type: 'sell', metal: 'gold', form: 'bars', coinType: null,
      qty: 100, customerId: null, date: new Date().toISOString(),
    }));
    expect(result.reportable).toBe(false);
  });

  test('check1099B returns not reportable for non-reportable products', async ({ page }) => {
    const result = await page.evaluate(() => check1099B({
      type: 'buy', metal: 'gold', form: 'coins', coinType: 'eagles',
      qty: 100, customerId: null, date: new Date().toISOString(),
    }));
    expect(result.reportable).toBe(false);
  });
});

// ─── 24-Hour Aggregation ────────────────────────────────────────────

test.describe('1099-B — 24-Hour Aggregation', () => {
  test('aggregates same customer + product within 24hrs to trigger flag', async ({ page }) => {
    const now = new Date().toISOString();

    await page.goto('/');
    await mockSpotPrices(page);
    await seedAndReload(page, {
      settings: BASE_SETTINGS,
      transactions: [
        {
          id: 'tx-agg-1', date: now, type: 'buy', metal: 'gold', form: 'bars',
          qty: 20, spot: 2500, price: 2375, total: 47500, profit: 2500,
          payment: 'wire', customerId: 'cust-1',
        },
      ],
      customers: [{ id: 'cust-1', name: 'Agg Customer', phone: '' }],
      contacts: [],
    });

    const result = await page.evaluate(() => check1099B({
      type: 'buy', metal: 'gold', form: 'bars', coinType: null,
      qty: 15, customerId: 'cust-1', date: new Date().toISOString(),
    }));
    // 20 + 15 = 35 >= 32.15 threshold
    expect(result.reportable).toBe(true);
    expect(result.reason).toContain('Combined');
  });

  test('does not aggregate different product types', async ({ page }) => {
    const now = new Date().toISOString();

    await page.goto('/');
    await mockSpotPrices(page);
    await seedAndReload(page, {
      settings: BASE_SETTINGS,
      transactions: [
        {
          id: 'tx-diff-1', date: now, type: 'buy', metal: 'gold', form: 'bars',
          qty: 20, spot: 2500, price: 2375, total: 47500, profit: 2500,
          payment: 'wire', customerId: 'cust-1',
        },
      ],
      customers: [{ id: 'cust-1', name: 'Diff Customer', phone: '' }],
      contacts: [],
    });

    // Buying gold rounds (different product key) — should NOT aggregate with bars
    const result = await page.evaluate(() => check1099B({
      type: 'buy', metal: 'gold', form: 'rounds', coinType: null,
      qty: 15, customerId: 'cust-1', date: new Date().toISOString(),
    }));
    expect(result.reportable).toBe(false);
  });

  test('does not aggregate different customers', async ({ page }) => {
    const now = new Date().toISOString();

    await page.goto('/');
    await mockSpotPrices(page);
    await seedAndReload(page, {
      settings: BASE_SETTINGS,
      transactions: [
        {
          id: 'tx-cust-1', date: now, type: 'buy', metal: 'gold', form: 'bars',
          qty: 20, spot: 2500, price: 2375, total: 47500, profit: 2500,
          payment: 'wire', customerId: 'cust-1',
        },
      ],
      customers: [
        { id: 'cust-1', name: 'Customer A', phone: '' },
        { id: 'cust-2', name: 'Customer B', phone: '' },
      ],
      contacts: [],
    });

    const result = await page.evaluate(() => check1099B({
      type: 'buy', metal: 'gold', form: 'bars', coinType: null,
      qty: 15, customerId: 'cust-2', date: new Date().toISOString(),
    }));
    expect(result.reportable).toBe(false);
  });
});

// ─── Calculator Warning ─────────────────────────────────────────────

test.describe('1099-B — Calculator Warning', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await mockSpotPrices(page);
    await seedAndReload(page, {
      settings: BASE_SETTINGS,
      transactions: [],
      customers: [{ id: 'cust-w9', name: 'W9 Customer', phone: '', w9OnFile: true }],
      contacts: [],
    });
    await page.click('[data-page="calculator"]');
  });

  test('shows 1099-B warning for buy of 35oz gold bars', async ({ page }) => {
    await page.selectOption('#calcMetal', 'gold');
    await page.selectOption('#calcForm', 'bars');
    await page.fill('#calcQty', '35');
    // Type is already 'buy' by default

    await expect(page.locator('#warning1099B')).toHaveClass(/visible/);
  });

  test('does not show 1099-B warning for sell transactions', async ({ page }) => {
    await page.selectOption('#calcMetal', 'gold');
    await page.selectOption('#calcForm', 'bars');
    await page.click('.segment-btn[data-value="sell"]');
    await page.fill('#calcQty', '35');

    await expect(page.locator('#warning1099B')).not.toHaveClass(/visible/);
  });

  test('does not show 1099-B warning for American Eagles', async ({ page }) => {
    await page.selectOption('#calcMetal', 'gold');
    await page.selectOption('#calcForm', 'coins');
    await page.selectOption('#calcCoinType', 'eagles');
    await page.fill('#calcQty', '100');

    await expect(page.locator('#warning1099B')).not.toHaveClass(/visible/);
  });

  test('does not show 1099-B warning for below-threshold quantity', async ({ page }) => {
    await page.selectOption('#calcMetal', 'gold');
    await page.selectOption('#calcForm', 'bars');
    await page.fill('#calcQty', '10');

    await expect(page.locator('#warning1099B')).not.toHaveClass(/visible/);
  });

  test('shows 1099-B warning for 25 Maple Leafs', async ({ page }) => {
    await page.selectOption('#calcMetal', 'gold');
    await page.selectOption('#calcForm', 'coins');
    await page.selectOption('#calcCoinType', 'maples');
    await page.fill('#calcQty', '25');

    await expect(page.locator('#warning1099B')).toHaveClass(/visible/);
  });
});

// ─── Flagging on Log Deal ───────────────────────────────────────────

test.describe('1099-B — Flagging on Log Deal', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await mockSpotPrices(page);
    await seedAndReload(page, {
      settings: BASE_SETTINGS,
      transactions: [],
      customers: [{ id: 'cust-flag-1', name: 'Flag Customer', phone: '' }],
      contacts: [],
    });
    await page.click('[data-page="calculator"]');
  });

  test('flags transaction when buying 35oz gold bars', async ({ page }) => {
    await page.selectOption('#calcMetal', 'gold');
    await page.selectOption('#calcForm', 'bars');
    await page.fill('#calcQty', '35');
    await page.click('#logDealBtn');

    const tx = await page.evaluate(() => {
      const txs = JSON.parse(localStorage.getItem('st_transactions'));
      return txs[0];
    });
    expect(tx.form1099BFlag).toBe(true);
  });

  test('does not flag when buying 10 American Eagles', async ({ page }) => {
    await page.selectOption('#calcMetal', 'gold');
    await page.selectOption('#calcForm', 'coins');
    await page.selectOption('#calcCoinType', 'eagles');
    await page.fill('#calcQty', '10');
    await page.click('#logDealBtn');

    const tx = await page.evaluate(() => {
      const txs = JSON.parse(localStorage.getItem('st_transactions'));
      return txs[0];
    });
    expect(tx.form1099BFlag).toBeUndefined();
  });

  test('does not flag sell transactions even for reportable products', async ({ page }) => {
    await page.selectOption('#calcMetal', 'gold');
    await page.selectOption('#calcForm', 'bars');
    await page.click('.segment-btn[data-value="sell"]');
    await page.fill('#calcQty', '50');
    await page.click('#logDealBtn');

    const tx = await page.evaluate(() => {
      const txs = JSON.parse(localStorage.getItem('st_transactions'));
      return txs[0];
    });
    expect(tx.form1099BFlag).toBeUndefined();
  });

  test('retroactively flags prior transactions on aggregation', async ({ page }) => {
    const now = new Date().toISOString();

    // Seed a prior buy of 20oz gold bars from the same customer
    await seedAndReload(page, {
      settings: BASE_SETTINGS,
      transactions: [
        {
          id: 'tx-retro-1', date: now, type: 'buy', metal: 'gold', form: 'bars',
          qty: 20, spot: 2500, price: 2375, total: 47500, profit: 2500,
          payment: 'wire', customerId: 'cust-flag-1',
        },
      ],
      customers: [{ id: 'cust-flag-1', name: 'Flag Customer', phone: '' }],
      contacts: [],
    });

    // Select customer, then log 15oz more (20 + 15 = 35 >= 32.15)
    await page.click('[data-page="calculator"]');
    await page.selectOption('#calcMetal', 'gold');
    await page.selectOption('#calcForm', 'bars');
    await page.fill('#calcQty', '15');

    // Select customer via hidden input
    await page.evaluate(() => {
      document.getElementById('selectedCustomerId').value = 'cust-flag-1';
      document.getElementById('customerSearch').value = 'Flag Customer';
    });
    await page.click('#logDealBtn');

    const txs = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('st_transactions'))
    );
    // Both should be flagged
    const retro = txs.find(t => t.id === 'tx-retro-1');
    const newTx = txs.find(t => t.id !== 'tx-retro-1');
    expect(retro.form1099BFlag).toBe(true);
    expect(newTx.form1099BFlag).toBe(true);
  });
});

// ─── Transaction Table Badges ───────────────────────────────────────

test.describe('1099-B — Transaction Table Rendering', () => {
  test('shows 1099-B badge on flagged transactions', async ({ page }) => {
    await page.goto('/');
    await mockSpotPrices(page);
    await seedAndReload(page, {
      settings: BASE_SETTINGS,
      transactions: [
        {
          id: 'tx-badge-1', date: '2025-01-15T12:00:00Z', type: 'buy', metal: 'gold', form: 'bars',
          qty: 35, spot: 2500, price: 2375, total: 83125, profit: 4375,
          payment: 'wire', form1099BFlag: true,
        },
      ],
      customers: [],
      contacts: [],
    });

    await page.click('[data-page="transactions"]');
    await expect(page.locator('.compliance-badge-1099b')).toBeVisible();
    await expect(page.locator('tr.compliance-row-1099b')).toBeVisible();
  });

  test('shows dual badges when both 8300 and 1099-B flagged', async ({ page }) => {
    await page.goto('/');
    await mockSpotPrices(page);
    await seedAndReload(page, {
      settings: BASE_SETTINGS,
      transactions: [
        {
          id: 'tx-dual-1', date: '2025-01-15T12:00:00Z', type: 'buy', metal: 'gold', form: 'bars',
          qty: 50, spot: 2500, price: 2375, total: 118750, profit: 6250,
          payment: 'cash', form8300Flag: true, form1099BFlag: true,
        },
      ],
      customers: [],
      contacts: [],
    });

    await page.click('[data-page="transactions"]');
    await expect(page.locator('.compliance-badge')).toBeVisible();
    await expect(page.locator('.compliance-badge-1099b')).toBeVisible();
    // Row should have both classes
    await expect(page.locator('tr.compliance-row-flagged.compliance-row-1099b')).toBeVisible();
  });
});

// ─── Filter Logic ───────────────────────────────────────────────────

test.describe('1099-B — Filters', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await mockSpotPrices(page);
    await seedAndReload(page, {
      settings: BASE_SETTINGS,
      transactions: [
        {
          id: 'tx-f1', date: '2025-01-15T12:00:00Z', type: 'buy', metal: 'gold', form: 'bars',
          qty: 35, spot: 2500, price: 2375, total: 83125, profit: 4375,
          payment: 'wire', form1099BFlag: true,
        },
        {
          id: 'tx-f2', date: '2025-01-15T13:00:00Z', type: 'buy', metal: 'gold', form: 'bars',
          qty: 35, spot: 2500, price: 2375, total: 83125, profit: 4375,
          payment: 'wire', form1099BFlag: true, form1099BFiled: true,
        },
        {
          id: 'tx-f3', date: '2025-01-16T12:00:00Z', type: 'buy', metal: 'gold', form: 'coins',
          coinType: 'eagles', qty: 5, spot: 2500, price: 2425, total: 12125, profit: 375,
          payment: 'cash',
        },
      ],
      customers: [],
      contacts: [],
    });
    await page.click('[data-page="transactions"]');
  });

  test('1099b-flagged filter shows only 1099-B flagged', async ({ page }) => {
    await page.selectOption('#filterCompliance', '1099b-flagged');
    const rows = await page.locator('#txBody tr').count();
    expect(rows).toBe(2);
  });

  test('1099b-needs-filing filter shows only unfiled', async ({ page }) => {
    await page.selectOption('#filterCompliance', '1099b-needs-filing');
    const rows = await page.locator('#txBody tr').count();
    expect(rows).toBe(1);
  });

  test('1099b-filed filter shows only filed', async ({ page }) => {
    await page.selectOption('#filterCompliance', '1099b-filed');
    const rows = await page.locator('#txBody tr').count();
    expect(rows).toBe(1);
  });

  test('any-compliance filter shows all flagged transactions', async ({ page }) => {
    // Add an 8300-only flagged tx
    await page.evaluate(() => {
      const txs = JSON.parse(localStorage.getItem('st_transactions'));
      txs.push({
        id: 'tx-f4', date: '2025-01-17T12:00:00Z', type: 'buy', metal: 'gold', form: 'coins',
        coinType: 'eagles', qty: 5, spot: 2500, price: 2425, total: 12125, profit: 375,
        payment: 'cash', form8300Flag: true,
      });
      localStorage.setItem('st_transactions', JSON.stringify(txs));
      transactions = txs;
      renderTransactions();
    });

    await page.selectOption('#filterCompliance', 'any-compliance');
    const rows = await page.locator('#txBody tr').count();
    // 2 with 1099-B + 1 with 8300 = 3
    expect(rows).toBe(3);
  });
});

// ─── Edit Modal — 1099-B ────────────────────────────────────────────

test.describe('1099-B — Edit Modal', () => {
  test('shows 1099-B filed checkbox for flagged transactions', async ({ page }) => {
    await page.goto('/');
    await mockSpotPrices(page);
    await seedAndReload(page, {
      settings: BASE_SETTINGS,
      transactions: [
        {
          id: 'tx-edit-1', date: '2025-01-15T12:00:00Z', type: 'buy', metal: 'gold', form: 'bars',
          qty: 35, spot: 2500, price: 2375, total: 83125, profit: 4375,
          payment: 'wire', form1099BFlag: true,
        },
      ],
      customers: [],
      contacts: [],
    });

    await page.click('[data-page="transactions"]');
    await page.locator('#txBody tr').first().locator('button', { hasText: '✏️' }).click();
    await expect(page.locator('#editModal')).toHaveClass(/open/);
    await expect(page.locator('#editForm1099BGroup')).toBeVisible();
  });

  test('hides 1099-B checkbox for non-flagged transactions', async ({ page }) => {
    await page.goto('/');
    await mockSpotPrices(page);
    await seedAndReload(page, {
      settings: BASE_SETTINGS,
      transactions: [
        {
          id: 'tx-edit-2', date: '2025-01-15T12:00:00Z', type: 'buy', metal: 'gold', form: 'coins',
          coinType: 'eagles', qty: 5, spot: 2500, price: 2425, total: 12125, profit: 375,
          payment: 'cash',
        },
      ],
      customers: [],
      contacts: [],
    });

    await page.click('[data-page="transactions"]');
    await page.locator('#txBody tr').first().locator('button', { hasText: '✏️' }).click();
    await expect(page.locator('#editModal')).toHaveClass(/open/);
    await expect(page.locator('#editForm1099BGroup')).not.toBeVisible();
  });

  test('persists form1099BFiled when checked and saved', async ({ page }) => {
    await page.goto('/');
    await mockSpotPrices(page);
    await seedAndReload(page, {
      settings: BASE_SETTINGS,
      transactions: [
        {
          id: 'tx-edit-3', date: '2025-01-15T12:00:00Z', type: 'buy', metal: 'gold', form: 'bars',
          qty: 35, spot: 2500, price: 2375, total: 83125, profit: 4375,
          payment: 'wire', form1099BFlag: true,
        },
      ],
      customers: [],
      contacts: [],
    });

    await page.click('[data-page="transactions"]');
    await page.locator('#txBody tr').first().locator('button', { hasText: '✏️' }).click();
    await page.check('#editForm1099BFiled');
    await page.click('#editSaveBtn');

    const tx = await page.evaluate(() => {
      const txs = JSON.parse(localStorage.getItem('st_transactions'));
      return txs.find(t => t.id === 'tx-edit-3');
    });
    expect(tx.form1099BFiled).toBe(true);
    expect(tx.form1099BFlag).toBe(true);
  });

  test('clears 1099-B flag when type changed to sell', async ({ page }) => {
    await page.goto('/');
    await mockSpotPrices(page);
    await seedAndReload(page, {
      settings: BASE_SETTINGS,
      transactions: [
        {
          id: 'tx-edit-4', date: '2025-01-15T12:00:00Z', type: 'buy', metal: 'gold', form: 'bars',
          qty: 35, spot: 2500, price: 2375, total: 83125, profit: 4375,
          payment: 'wire', form1099BFlag: true,
        },
      ],
      customers: [],
      contacts: [],
    });

    await page.click('[data-page="transactions"]');
    await page.locator('#txBody tr').first().locator('button', { hasText: '✏️' }).click();
    await page.selectOption('#editType', 'sell');
    await page.click('#editSaveBtn');

    const tx = await page.evaluate(() => {
      const txs = JSON.parse(localStorage.getItem('st_transactions'));
      return txs.find(t => t.id === 'tx-edit-4');
    });
    expect(tx.form1099BFlag).toBeUndefined();
  });
});

// ─── CSV Export ──────────────────────────────────────────────────────

test.describe('1099-B — CSV Export', () => {
  test('CSV includes 1099-B column with correct values', async ({ page }) => {
    const fs = require('fs');

    await page.goto('/');
    await mockSpotPrices(page);
    await seedAndReload(page, {
      settings: BASE_SETTINGS,
      transactions: [
        {
          id: 'tx-csv-1', date: '2025-01-15T12:00:00Z', type: 'buy', metal: 'gold', form: 'bars',
          qty: 35, spot: 2500, price: 2375, total: 83125, profit: 4375,
          payment: 'wire', form1099BFlag: true,
        },
        {
          id: 'tx-csv-2', date: '2025-01-15T13:00:00Z', type: 'buy', metal: 'gold', form: 'bars',
          qty: 35, spot: 2500, price: 2375, total: 83125, profit: 4375,
          payment: 'wire', form1099BFlag: true, form1099BFiled: true,
        },
        {
          id: 'tx-csv-3', date: '2025-01-16T12:00:00Z', type: 'buy', metal: 'gold', form: 'coins',
          coinType: 'eagles', qty: 5, spot: 2500, price: 2425, total: 12125, profit: 375,
          payment: 'cash',
        },
      ],
      customers: [],
      contacts: [],
    });

    await page.click('[data-page="transactions"]');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#exportCsvBtn'),
    ]);

    const filePath = await download.path();
    const csv = fs.readFileSync(filePath, 'utf-8');
    const lines = csv.split('\n');

    // Header should contain 1099-B
    expect(lines[0]).toContain('"1099-B"');

    // Check full CSV content for expected values
    const dataLines = lines.slice(1).filter(l => l.trim());
    expect(dataLines).toHaveLength(3);

    // Count occurrences across all data lines
    const flaggedCount = dataLines.filter(l => l.includes('"Flagged"')).length;
    const filedCount = dataLines.filter(l => l.includes('"Filed"')).length;

    // 2 transactions have 1099-B flags: one Flagged, one Filed
    // The "Flagged" one also has Form 8300 empty so "Flagged" appears once for 1099-B
    // The "Filed" one appears once
    expect(flaggedCount).toBeGreaterThanOrEqual(1);
    expect(filedCount).toBeGreaterThanOrEqual(1);
  });
});

// ─── Receipt ────────────────────────────────────────────────────────

test.describe('1099-B — Receipt', () => {
  test('shows 1099-B notice on flagged transaction receipt', async ({ page }) => {
    await page.goto('/');
    await mockSpotPrices(page);
    await seedAndReload(page, {
      settings: BASE_SETTINGS,
      transactions: [
        {
          id: 'tx-rcpt-1', date: '2025-01-15T12:00:00Z', type: 'buy', metal: 'gold', form: 'bars',
          qty: 35, spot: 2500, price: 2375, total: 83125, profit: 4375,
          payment: 'wire', form1099BFlag: true,
        },
      ],
      customers: [],
      contacts: [],
    });

    await page.click('[data-page="transactions"]');
    await page.locator('#txBody tr').first().locator('button', { hasText: '🧾' }).click();
    await expect(page.locator('#receiptModal')).toHaveClass(/open/);

    const receiptText = await page.locator('#receiptContent').textContent();
    expect(receiptText).toContain('1099-B');
    expect(receiptText).toContain('W-9');
  });

  test('does not show 1099-B notice on non-flagged receipt', async ({ page }) => {
    await page.goto('/');
    await mockSpotPrices(page);
    await seedAndReload(page, {
      settings: BASE_SETTINGS,
      transactions: [
        {
          id: 'tx-rcpt-2', date: '2025-01-15T12:00:00Z', type: 'buy', metal: 'gold', form: 'coins',
          coinType: 'eagles', qty: 5, spot: 2500, price: 2425, total: 12125, profit: 375,
          payment: 'cash',
        },
      ],
      customers: [],
      contacts: [],
    });

    await page.click('[data-page="transactions"]');
    await page.locator('#txBody tr').first().locator('button', { hasText: '🧾' }).click();
    await expect(page.locator('#receiptModal')).toHaveClass(/open/);

    const receiptText = await page.locator('#receiptContent').textContent();
    expect(receiptText).not.toContain('1099-B');
  });
});

// ─── W-9 Customer Tracking ──────────────────────────────────────────

test.describe('1099-B — W-9 Customer Tracking', () => {
  test('saves w9OnFile when creating a customer with W-9 checked', async ({ page }) => {
    await page.goto('/');
    await mockSpotPrices(page);
    await seedAndReload(page, {
      settings: BASE_SETTINGS,
      transactions: [],
      customers: [],
      contacts: [],
    });
    await page.click('[data-page="calculator"]');

    // Type a new customer name to trigger dropdown
    await page.fill('#customerSearch', 'W9 Test Customer');
    await page.locator('.customer-dropdown-item.add-new').click();

    // In the modal, check W-9 and save
    await expect(page.locator('#addCustomerModal')).toHaveClass(/open/);
    await page.check('#newCustomerW9');
    await page.click('#addCustomerSaveBtn');

    const customers = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('st_customers'))
    );
    expect(customers).toHaveLength(1);
    expect(customers[0].w9OnFile).toBe(true);
  });

  test('saves w9OnFile as false when W-9 not checked', async ({ page }) => {
    await page.goto('/');
    await mockSpotPrices(page);
    await seedAndReload(page, {
      settings: BASE_SETTINGS,
      transactions: [],
      customers: [],
      contacts: [],
    });
    await page.click('[data-page="calculator"]');

    await page.fill('#customerSearch', 'No W9 Customer');
    await page.locator('.customer-dropdown-item.add-new').click();
    await expect(page.locator('#addCustomerModal')).toHaveClass(/open/);
    await page.click('#addCustomerSaveBtn');

    const customers = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('st_customers'))
    );
    expect(customers).toHaveLength(1);
    expect(customers[0].w9OnFile).toBe(false);
  });

  test('customer dropdown shows W-9 status indicator', async ({ page }) => {
    await page.goto('/');
    await mockSpotPrices(page);
    await seedAndReload(page, {
      settings: BASE_SETTINGS,
      transactions: [],
      customers: [
        { id: 'cust-w9-yes', name: 'Has W9', phone: '', w9OnFile: true },
        { id: 'cust-w9-no', name: 'Has No W9', phone: '', w9OnFile: false },
      ],
      contacts: [],
    });
    await page.click('[data-page="calculator"]');

    await page.fill('#customerSearch', 'Has');
    await page.waitForSelector('.customer-dropdown.open');

    const dropdownHtml = await page.locator('#customerDropdown').innerHTML();
    expect(dropdownHtml).toContain('W-9 ✓');
    expect(dropdownHtml).toContain('No W-9');
  });
});

// ─── Alert Banner ───────────────────────────────────────────────────

test.describe('1099-B — Alert Banner', () => {
  test('shows alert for unfiled 1099-B transactions', async ({ page }) => {
    await page.goto('/');
    await mockSpotPrices(page);
    await seedAndReload(page, {
      settings: BASE_SETTINGS,
      transactions: [
        {
          id: 'tx-alert-1', date: '2025-01-15T12:00:00Z', type: 'buy', metal: 'gold', form: 'bars',
          qty: 35, spot: 2500, price: 2375, total: 83125, profit: 4375,
          payment: 'wire', form1099BFlag: true,
        },
      ],
      customers: [],
      contacts: [],
    });

    await expect(page.locator('#alertBanner')).toHaveClass(/visible/);
    const alertText = await page.locator('#alertText').textContent();
    expect(alertText).toContain('1099-B');
  });

  test('no 1099-B alert when all are filed', async ({ page }) => {
    await page.goto('/');
    await mockSpotPrices(page);
    await seedAndReload(page, {
      settings: { ...BASE_SETTINGS, threshGold: 9999, threshSilver: 99999 },
      transactions: [
        {
          id: 'tx-alert-2', date: '2025-01-15T12:00:00Z', type: 'buy', metal: 'gold', form: 'bars',
          qty: 35, spot: 2500, price: 2375, total: 83125, profit: 4375,
          payment: 'wire', form1099BFlag: true, form1099BFiled: true,
        },
      ],
      customers: [],
      contacts: [],
    });

    const alertText = await page.locator('#alertText').textContent();
    expect(alertText).not.toContain('1099-B');
  });
});
