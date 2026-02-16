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

function emptyData() {
  return { settings: BASE_SETTINGS, transactions: [], customers: [], contacts: [] };
}

// ─── Multi-Line Deal Tests ──────────────────────────────────────────

test.describe('Multi-Line Deal Calculator', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await mockSpotPrices(page);
    await seedAndReload(page, emptyData());
    await page.click('[data-page="calculator"]');
  });

  test('Add Line button visible and disabled when qty is 0', async ({ page }) => {
    // Ensure qty is empty/0
    await page.fill('#calcQty', '');
    const addLineBtn = page.locator('#addLineBtn');
    await expect(addLineBtn).toBeVisible();
    await expect(addLineBtn).toBeDisabled();
  });

  test('Adding a line shows it in deal summary with correct description and total', async ({ page }) => {
    // Set up a gold bars line
    await page.selectOption('#calcMetal', 'gold');
    await page.selectOption('#calcForm', 'bars');
    await page.fill('#calcQty', '10');

    // Add line button should be enabled now
    await expect(page.locator('#addLineBtn')).toBeEnabled();
    await page.click('#addLineBtn');

    // Deal lines container should be visible
    const container = page.locator('#dealLinesContainer');
    await expect(container).toBeVisible();

    // Should show count badge of 1
    await expect(page.locator('#dealLinesCount')).toHaveText('1');

    // Should show the line description containing Gold and Bars
    const lineItem = page.locator('.deal-line-item').first();
    await expect(lineItem).toContainText('Gold');
    await expect(lineItem).toContainText('Bars');
    await expect(lineItem).toContainText('10.000');

    // Qty field should be cleared after adding line
    await expect(page.locator('#calcQty')).toHaveValue('');
  });

  test('Remove line from deal summary', async ({ page }) => {
    // Add a line
    await page.selectOption('#calcMetal', 'gold');
    await page.selectOption('#calcForm', 'bars');
    await page.fill('#calcQty', '5');
    await page.click('#addLineBtn');

    // Verify line is shown
    await expect(page.locator('#dealLinesContainer')).toBeVisible();
    await expect(page.locator('.deal-line-item')).toHaveCount(1);

    // Remove the line
    await page.click('.deal-line-remove');

    // Container should be hidden
    await expect(page.locator('#dealLinesContainer')).toBeHidden();
  });

  test('Log single line — tx has lines array with 1 entry', async ({ page }) => {
    await page.selectOption('#calcMetal', 'gold');
    await page.selectOption('#calcForm', 'bars');
    await page.fill('#calcQty', '5');
    await page.click('#logDealBtn');

    // Wait for deal logged message
    await expect(page.locator('#dealLoggedMsg')).toHaveClass(/show/);

    // Verify transaction in localStorage
    const tx = await page.evaluate(() => {
      const txs = JSON.parse(localStorage.getItem('st_transactions'));
      return txs[0];
    });

    expect(tx.lines).toBeDefined();
    expect(tx.lines).toHaveLength(1);
    expect(tx.lines[0].metal).toBe('gold');
    expect(tx.lines[0].form).toBe('bars');
    expect(tx.lines[0].qty).toBe(5);
    // Single-line should have flat fields for backward compat
    expect(tx.metal).toBe('gold');
    expect(tx.form).toBe('bars');
    expect(tx.qty).toBe(5);
  });

  test('Log multi-line (gold bars + silver rounds) — tx.total = sum, tx.profit = sum', async ({ page }) => {
    // Add gold bars line
    await page.selectOption('#calcMetal', 'gold');
    await page.selectOption('#calcForm', 'bars');
    await page.fill('#calcQty', '2');
    await page.click('#addLineBtn');

    // Add silver rounds line
    await page.selectOption('#calcMetal', 'silver');
    await page.selectOption('#calcForm', 'rounds');
    await page.fill('#calcQty', '100');
    await page.click('#logDealBtn');

    // Wait for deal logged message
    await expect(page.locator('#dealLoggedMsg')).toHaveClass(/show/);

    const tx = await page.evaluate(() => {
      const txs = JSON.parse(localStorage.getItem('st_transactions'));
      return txs[0];
    });

    expect(tx.lines).toHaveLength(2);
    expect(tx.lines[0].metal).toBe('gold');
    expect(tx.lines[0].form).toBe('bars');
    expect(tx.lines[1].metal).toBe('silver');
    expect(tx.lines[1].form).toBe('rounds');

    // tx.total should be sum of line totals
    const lineSum = tx.lines[0].total + tx.lines[1].total;
    expect(tx.total).toBeCloseTo(lineSum, 2);

    // tx.profit should be sum of line profits
    const profitSum = tx.lines[0].profit + tx.lines[1].profit;
    expect(tx.profit).toBeCloseTo(profitSum, 2);
  });

  test('Form 8300 triggers on combined deal total (each line < $10k, combined >= $10k)', async ({ page }) => {
    // Use cash payment
    await page.selectOption('#calcPayment', 'cash');

    // Add gold bars line — buy 2 oz at ~$2375/oz (with 5% buy discount) = ~$4750
    await page.selectOption('#calcMetal', 'gold');
    await page.selectOption('#calcForm', 'bars');
    await page.fill('#calcQty', '2');
    await page.click('#addLineBtn');

    // Add another gold bars line — buy 3 oz = ~$7125 — combined > $10k
    await page.fill('#calcQty', '3');

    // Cash warning should show for combined total
    await expect(page.locator('#cashWarning')).toHaveClass(/visible/);
  });

  test('1099-B triggers per-line (one line reportable, one not)', async ({ page }) => {
    // Set type to buy
    await page.click('.segment-btn[data-value="buy"]');

    // Add gold eagles (NOT 1099-B reportable) - 30 oz
    await page.selectOption('#calcMetal', 'gold');
    await page.selectOption('#calcForm', 'coins');
    await page.selectOption('#calcCoinType', 'eagles');
    await page.fill('#calcQty', '30');
    await page.click('#addLineBtn');

    // Add gold bars (1099-B reportable at 32.15 oz) - 35 oz
    await page.selectOption('#calcForm', 'bars');
    await page.fill('#calcQty', '35');
    await page.click('#logDealBtn');

    // Check the logged tx
    const tx = await page.evaluate(() => {
      const txs = JSON.parse(localStorage.getItem('st_transactions'));
      return txs[0];
    });

    expect(tx.lines).toHaveLength(2);
    // The tx should have 1099-B flag because gold bars line is reportable
    expect(tx.form1099BFlag).toBe(true);
  });
});

// ─── Backward Compatibility ──────────────────────────────────────────

test.describe('Backward Compatibility', () => {
  test('old flat tx without lines displays correctly', async ({ page }) => {
    const oldTx = {
      id: 'legacy-tx-1',
      date: '2025-06-01T10:00:00Z',
      metal: 'gold',
      form: 'coins',
      coinType: 'eagles',
      type: 'buy',
      qty: 5,
      spot: 2500,
      price: 2425,
      total: 12125,
      profit: 375,
      payment: 'cash',
    };

    await page.goto('/');
    await mockSpotPrices(page);
    await seedAndReload(page, {
      settings: BASE_SETTINGS,
      transactions: [oldTx],
      customers: [],
      contacts: [],
    });

    // Go to transactions page
    await page.click('[data-page="transactions"]');

    // Should render the old tx with correct metal and form
    const row = page.locator('#txBody tr').first();
    await expect(row).toContainText('Gold');
    await expect(row).toContainText('Coins');
    await expect(row).toContainText('5.000');

    // getTxLines should work on legacy tx
    const lines = await page.evaluate(() => {
      const txs = JSON.parse(localStorage.getItem('st_transactions'));
      return getTxLines(txs[0]);
    });
    expect(lines).toHaveLength(1);
    expect(lines[0].metal).toBe('gold');
    expect(lines[0].qty).toBe(5);
  });
});

// ─── Filter, Inventory, Receipt, CSV ──────────────────────────────────

test.describe('Multi-line downstream features', () => {
  const multiLineTx = {
    id: 'multi-tx-1',
    date: new Date().toISOString(),
    type: 'buy',
    total: 10000,
    profit: 500,
    payment: 'wire',
    lines: [
      { metal: 'gold', form: 'bars', qty: 2, spot: 2500, price: 2375, total: 4750, profit: 250 },
      { metal: 'silver', form: 'rounds', qty: 200, spot: 32, price: 26.25, total: 5250, profit: 250 },
    ],
  };

  test('Filter by metal matches multi-line tx containing that metal', async ({ page }) => {
    await page.goto('/');
    await mockSpotPrices(page);
    await seedAndReload(page, {
      settings: BASE_SETTINGS,
      transactions: [multiLineTx],
      customers: [],
      contacts: [],
    });

    await page.click('[data-page="transactions"]');

    // Filter by gold — should show the multi-line tx
    await page.selectOption('#filterMetal', 'gold');
    await expect(page.locator('#txBody tr')).toHaveCount(1);

    // Filter by silver — should also show it
    await page.selectOption('#filterMetal', 'silver');
    await expect(page.locator('#txBody tr')).toHaveCount(1);
  });

  test('Inventory correctly accounts for multi-line tx', async ({ page }) => {
    await page.goto('/');
    await mockSpotPrices(page);
    await seedAndReload(page, {
      settings: BASE_SETTINGS,
      transactions: [multiLineTx],
      customers: [],
      contacts: [],
    });

    // Check inventory via evaluate
    const inv = await page.evaluate(() => getInventory());

    // Gold bars: 2 oz bought
    expect(inv.inv.gold.bars).toBeCloseTo(2, 3);
    // Silver rounds: 200 oz bought
    expect(inv.inv.silver.rounds).toBeCloseTo(200, 3);
  });

  test('Receipt shows all items for multi-line deal', async ({ page }) => {
    await page.goto('/');
    await mockSpotPrices(page);
    await seedAndReload(page, {
      settings: BASE_SETTINGS,
      transactions: [multiLineTx],
      customers: [],
      contacts: [],
    });

    await page.click('[data-page="transactions"]');

    // Open receipt
    await page.click('.row-action-btn[title="Receipt"]');
    await expect(page.locator('#receiptModal')).toHaveClass(/open/);

    // Should show Item 1 and Item 2
    const receiptContent = page.locator('#receiptContent');
    await expect(receiptContent).toContainText('Item 1');
    await expect(receiptContent).toContainText('Item 2');
    await expect(receiptContent).toContainText('Gold');
    await expect(receiptContent).toContainText('Silver');
  });

  test('CSV exports one row per line with shared Deal ID', async ({ page }) => {
    await page.goto('/');
    await mockSpotPrices(page);
    await seedAndReload(page, {
      settings: BASE_SETTINGS,
      transactions: [multiLineTx],
      customers: [],
      contacts: [],
    });

    await page.click('[data-page="transactions"]');

    // Intercept the download
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#exportCsvBtn'),
    ]);

    const csvContent = await download.createReadStream().then(stream => {
      return new Promise(resolve => {
        let data = '';
        stream.on('data', chunk => data += chunk);
        stream.on('end', () => resolve(data));
      });
    });

    const csvLines = csvContent.trim().split('\n');
    // Header + 2 data rows (one per line)
    expect(csvLines.length).toBe(3);

    // Both rows should share the same Deal ID
    const header = csvLines[0];
    expect(header).toContain('Deal ID');

    // Parse Deal ID from both data rows
    const row1DealId = csvLines[1].split(',')[0];
    const row2DealId = csvLines[2].split(',')[0];
    expect(row1DealId).toBe(row2DealId);
  });
});
