const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const TEST_DATA = {
  settings: {
    shopName: 'Test Bullion Shop',
    sellPremCoins: 7, sellPremBars: 5, sellPremScrap: 3,
    buyDiscCoins: 3, buyDiscBars: 5, buyDiscScrap: 8,
    whDiscCoins: 1, whDiscBars: 2, whDiscScrap: 3,
    coinAdjustments: { eagles: 0, maples: 0, krugerrands: 0, britannias: 0, philharmonics: 0 },
    junkDivisor: 1.3, junkMultOverride: null,
    threshGold: 10, threshSilver: 500,
  },
  transactions: [
    {
      id: 'tx-test-1',
      date: '2025-01-15T12:00:00Z',
      type: 'buy',
      metal: 'gold',
      form: 'coins',
      coinType: 'eagles',
      qty: 2,
      spot: 2000,
      price: 1940,
      total: 3880,
      profit: 0,
      payment: 'cash',
      customerId: 'cust-test-1',
      notes: 'test buy',
    },
    {
      id: 'tx-test-2',
      date: '2025-01-20T14:00:00Z',
      type: 'sell',
      metal: 'gold',
      form: 'coins',
      coinType: 'eagles',
      qty: 1,
      spot: 2050,
      price: 2194,
      total: 2194,
      profit: 254,
      payment: 'wire',
      customerId: 'cust-test-1',
      notes: 'test sell',
    },
  ],
  customers: [
    { id: 'cust-test-1', name: 'Test Customer', email: 'test@example.com', phone: '' },
  ],
  contacts: [
    { id: 'cont-test-1', name: 'Test Contact', role: 'Supplier', phone: '555-0100', email: 'contact@example.com', notes: '' },
  ],
};

test.describe('Export / Import', () => {
  let downloadedData;

  test.beforeEach(async ({ page }) => {
    // Seed localStorage with test data then reload so the app picks it up
    await page.goto('/');
    await page.evaluate((data) => {
      localStorage.setItem('st_settings', JSON.stringify(data.settings));
      localStorage.setItem('st_transactions', JSON.stringify(data.transactions));
      localStorage.setItem('st_customers', JSON.stringify(data.customers));
      localStorage.setItem('st_contacts', JSON.stringify(data.contacts));
    }, TEST_DATA);
    await page.reload();
  });

  test('exports data as JSON with correct structure', async ({ page }) => {
    // Navigate to Settings
    await page.click('[data-page="settings"]');

    // Listen for the download
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#exportDataBtn'),
    ]);

    // Read downloaded file
    const filePath = await download.path();
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    downloadedData = JSON.parse(fileContent);

    // Structure checks
    expect(downloadedData).toHaveProperty('version', 1);
    expect(downloadedData).toHaveProperty('exportedAt');
    expect(new Date(downloadedData.exportedAt).getTime()).not.toBeNaN();

    // Data checks
    expect(downloadedData.transactions).toHaveLength(2);
    expect(downloadedData.transactions[0].id).toBe('tx-test-1');
    expect(downloadedData.customers).toHaveLength(1);
    expect(downloadedData.customers[0].name).toBe('Test Customer');
    expect(downloadedData.contacts).toHaveLength(1);
    expect(downloadedData.settings.shopName).toBe('Test Bullion Shop');

    // Save for import test
    const tmpPath = path.join(__dirname, 'tmp-export.json');
    fs.writeFileSync(tmpPath, fileContent);
  });

  test('imports previously exported data and restores state', async ({ page }) => {
    // First, export to get a valid file
    await page.click('[data-page="settings"]');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#exportDataBtn'),
    ]);
    const filePath = await download.path();
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const tmpPath = path.join(__dirname, 'tmp-export.json');
    fs.writeFileSync(tmpPath, fileContent);

    // Clear localStorage and reload
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    // Verify localStorage is empty
    const beforeImport = await page.evaluate(() => localStorage.getItem('st_transactions'));
    expect(beforeImport).toBeNull();

    // Navigate to Settings and import
    await page.click('[data-page="settings"]');
    await page.setInputFiles('#importFileInput', tmpPath);

    // Assert success feedback
    await expect(page.locator('#dataConfirm')).toContainText('Data imported!');

    // Assert localStorage restored
    const restored = await page.evaluate(() => ({
      transactions: JSON.parse(localStorage.getItem('st_transactions')),
      customers: JSON.parse(localStorage.getItem('st_customers')),
      contacts: JSON.parse(localStorage.getItem('st_contacts')),
    }));
    expect(restored.transactions).toHaveLength(2);
    expect(restored.customers).toHaveLength(1);
    expect(restored.contacts).toHaveLength(1);

    // Assert UI updated — transactions table should have rows
    await page.click('[data-page="transactions"]');
    const rowCount = await page.locator('#txBody tr').count();
    expect(rowCount).toBeGreaterThanOrEqual(2);

    // Cleanup
    fs.unlinkSync(tmpPath);
  });

  test('shows error feedback for invalid JSON import', async ({ page }) => {
    // Create an invalid JSON file
    const invalidPath = path.join(__dirname, 'tmp-invalid.json');
    fs.writeFileSync(invalidPath, '{ this is not valid json!!!');

    await page.click('[data-page="settings"]');
    await page.setInputFiles('#importFileInput', invalidPath);

    // Assert error feedback
    await expect(page.locator('#dataConfirm')).toContainText('Import failed');

    fs.unlinkSync(invalidPath);
  });

  test('shows error for valid JSON with missing required fields', async ({ page }) => {
    // Valid JSON but missing transactions/customers arrays
    const badStructurePath = path.join(__dirname, 'tmp-bad-structure.json');
    fs.writeFileSync(badStructurePath, JSON.stringify({ version: 1, settings: {} }));

    await page.click('[data-page="settings"]');
    await page.setInputFiles('#importFileInput', badStructurePath);

    await expect(page.locator('#dataConfirm')).toContainText('Import failed');

    fs.unlinkSync(badStructurePath);
  });
});
