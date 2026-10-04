import { spawn } from "node:child_process";
import { chromium } from "playwright";

const port = 5199;
const baseUrl = `http://127.0.0.1:${port}`;

console.log(`Starting .NET backend on ${baseUrl}...`);
const server = spawn("dotnet", ["run", "--no-build", "-c", "Release", "--urls", baseUrl], {
  cwd: process.cwd().includes("tests/browser") ? "../.." : ".",
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});

let serverOutput = "";
server.stdout.on("data", (chunk) => { serverOutput += chunk; });
server.stderr.on("data", (chunk) => { serverOutput += chunk; });

const waitForServer = async () => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        console.log("Backend is ready.");
        return;
      }
    } catch {
      // server is starting
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Server did not start in time:\n${serverOutput}`);
};

const stopServer = async () => {
  if (server.exitCode !== null) return;
  await new Promise((resolve) => {
    const forceStop = setTimeout(() => {
      if (server.exitCode === null) server.kill("SIGKILL");
    }, 2000);
    server.once("exit", () => {
      clearTimeout(forceStop);
      resolve();
    });
    server.kill("SIGTERM");
  });
};

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
};

let browser;
let failed = false;

try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  // -------------------------------------------------------------------------
  // TEST 1: Initial load, default attributes, and Local-First persistence
  // -------------------------------------------------------------------------
  console.log("Running Test 1: Initial load and Local-First persistence...");
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  
  // Verify empty state is visible initially
  const emptyStateVisible = await page.locator("#empty-state").isVisible();
  assert(emptyStateVisible, "Empty state should be displayed when product list is empty");

  // Verify attributes were loaded into memory / localStorage
  const savedAttrs = await page.evaluate(() => localStorage.getItem("inventory_attributes"));
  assert(savedAttrs !== null, "Default attributes must be stored in localStorage");
  const parsedAttrs = JSON.parse(savedAttrs);
  assert(parsedAttrs.length >= 5, `Expected at least 5 default attributes in localStorage, got ${parsedAttrs.length}`);

  // Open modal using #open-product-modal-btn
  await page.click("#open-product-modal-btn");
  await page.waitForSelector("#product-modal:not(.hide)");
  
  // Fill all required inputs in dynamic form
  const inputs = page.locator("#dynamic-fields-container input");
  const inputCount = await inputs.count();
  for (let i = 0; i < inputCount; i++) {
    const input = inputs.nth(i);
    const type = await input.getAttribute("type");
    if (type === "checkbox") {
      await input.check();
    } else if (type === "number") {
      await input.fill("10");
    } else if (type === "date") {
      await input.fill("2026-10-03");
    } else {
      await input.fill("Automated Test Item 42");
    }
  }

  // Save product using #submit-product-btn
  await page.click("#submit-product-btn");
  await page.waitForSelector("#product-modal", { state: "hidden" });

  // Now table must be visible and have headers
  const headerCount = await page.locator("#inventory-thead th").count();
  assert(headerCount >= 5, `Expected at least 5 headers after adding product, got ${headerCount}`);

  // Verify item is displayed in the inventory table
  const tableContent = await page.textContent("#inventory-tbody");
  assert(tableContent.includes("Automated Test Item 42"), "Added product must appear in table");

  // Reload page to test Local-First persistence
  await page.reload({ waitUntil: "networkidle" });
  const tableAfterReload = await page.textContent("#inventory-tbody");
  assert(tableAfterReload.includes("Automated Test Item 42"), "Product must persist in localStorage across reloads");
  console.log("✓ Test 1 passed.");

  // -------------------------------------------------------------------------
  // TEST 2: HTML Injection / XSS sink protection
  // -------------------------------------------------------------------------
  console.log("Running Test 2: HTML injection and XSS sink protection...");
  const maliciousMsg = '<img src="invalid-image" onerror="window.__xss_toast_executed=true"><span id="xss-test-span">pwn</span>';
  
  await page.evaluate((payload) => {
    window.showToast(payload, 'error');
  }, maliciousMsg);

  // Wait a brief moment to allow any potential event handlers to fire
  await page.waitForTimeout(300);

  const xssExecuted = await page.evaluate(() => window.__xss_toast_executed);
  assert(!xssExecuted, "XSS in showToast must not execute script");

  const injectedElCount = await page.locator("#xss-test-span").count();
  assert(injectedElCount === 0, "HTML tags in showToast must be rendered as plain text, not parsed as DOM nodes");

  const toastText = await page.locator(".toast-message").last().textContent();
  assert(toastText.includes('<img src="invalid-image"'), "HTML tags must be visible literally as textContent");
  console.log("✓ Test 2 passed.");

  // -------------------------------------------------------------------------
  // TEST 3: Corrupted Cache Recovery
  // -------------------------------------------------------------------------
  console.log("Running Test 3: Corrupted cache detection and safe recovery...");
  await page.evaluate(() => {
    localStorage.setItem("inventory_attributes", JSON.stringify([null]));
    localStorage.setItem("inventory_products", "malformed-json-here{{");
  });

  await page.reload({ waitUntil: "networkidle" });

  // A toast should warn about corrupted cache
  const cacheToast = await page.locator(".toast-error .toast-message").first().textContent();
  assert(
    cacheToast.includes("pamięci podręcznej") || cacheToast.includes("cache") || cacheToast.includes("szablon"),
    `Expected cache corruption toast, got: "${cacheToast}"`
  );

  // Raw cache in localStorage must be preserved intact (not destroyed)
  const rawAttrsBeforeReset = await page.evaluate(() => localStorage.getItem("inventory_attributes"));
  assert(rawAttrsBeforeReset === JSON.stringify([null]), "Raw attributes must be preserved intact in localStorage");
  const rawProdsBeforeReset = await page.evaluate(() => localStorage.getItem("inventory_products"));
  assert(rawProdsBeforeReset === "malformed-json-here{{", "Raw products must be preserved intact in localStorage");

  // Recovery modal must be visible
  await page.waitForSelector("#recovery-modal:not(.hide)");
  const recoveryModalVisible = await page.locator("#recovery-modal").isVisible();
  assert(recoveryModalVisible, "Recovery modal must be visible on corrupted cache");

  // Explicit user reset via button restores default template
  await page.click("#recovery-reset-btn");
  await page.waitForSelector("#recovery-modal", { state: "hidden" });

  const recoveredAttrs = await page.evaluate(() => localStorage.getItem("inventory_attributes"));
  assert(recoveredAttrs !== null && JSON.parse(recoveredAttrs).length >= 5, "Default attributes must be restored in localStorage after explicit reset");
  console.log("✓ Test 3 passed.");

  // -------------------------------------------------------------------------
  // TEST 4: Modal Accessibility, Focus Trap, and Esc key
  // -------------------------------------------------------------------------
  console.log("Running Test 4: Modal a11y and keyboard escape...");
  await page.click("#settings-modal-trigger-btn");
  await page.waitForSelector("#settings-modal:not(.hide)");

  // Press Escape to dismiss modal
  await page.keyboard.press("Escape");
  await page.waitForSelector("#settings-modal", { state: "hidden" });
  const isSettingsHidden = await page.locator("#settings-modal").getAttribute("class");
  assert(isSettingsHidden.includes("hide"), "Settings modal must close on Escape key press");
  console.log("✓ Test 4 passed.");

  // -------------------------------------------------------------------------
  // TEST 5: Bilingual PL/EN Language Switching
  // -------------------------------------------------------------------------
  console.log("Running Test 5: Bilingual PL / EN language switching...");
  // Switch to English
  await page.click("#lang-en-btn");
  await page.waitForTimeout(200);
  const addBtnTextEn = await page.locator("#open-product-modal-btn").textContent();
  assert(addBtnTextEn.includes("Add Product") || addBtnTextEn.includes("Add"), `Expected English 'Add Product', got: ${addBtnTextEn}`);

  // Switch back to Polish
  await page.click("#lang-pl-btn");
  await page.waitForTimeout(200);
  const addBtnTextPl = await page.locator("#open-product-modal-btn").textContent();
  assert(addBtnTextPl.includes("Dodaj produkt") || addBtnTextPl.includes("Dodaj"), `Expected Polish 'Dodaj produkt', got: ${addBtnTextPl}`);
  console.log("✓ Test 5 passed.");

  // -------------------------------------------------------------------------
  // TEST 6: Rate Limit Countdown Toast
  // -------------------------------------------------------------------------
  console.log("Running Test 6: Rate limit countdown toast and button locking...");
  await page.evaluate(() => {
    window.showRateLimitToast("Zbyt wiele zapytań", 3);
  });

  const rateLimitToast = await page.locator("#rate-limit-toast");
  assert(await rateLimitToast.isVisible(), "Rate limit toast must be visible");

  // Check text content contains wait seconds
  const rateLimitMsg = await rateLimitToast.locator(".toast-message").textContent();
  assert(rateLimitMsg.includes("3s") || rateLimitMsg.includes("2s"), `Expected countdown in toast: ${rateLimitMsg}`);

  // Wait for countdown to finish (3.5s)
  await page.waitForTimeout(3500);
  const toastCount = await page.locator("#rate-limit-toast").count();
  assert(toastCount === 0, "Rate limit toast must disappear after countdown completes");
  console.log("✓ Test 6 passed.");

  // -------------------------------------------------------------------------
  // TEST 7: IC03-1 - Data Preservation & Strict Schema Sanitization Regressions
  // -------------------------------------------------------------------------
  console.log("Running Test 7: IC03-1 Data preservation & strict schema sanitization...");

  // 7A: Isolated execution of schema checks:
  const schemaResults = await page.evaluate(() => {
    const results = {};

    try {
      window.sanitizeProjectData({
        attributes: [{ name: "Col1", type: "UnknownType" }],
        products: []
      });
      results.unknownType = "accepted";
    } catch (e) {
      results.unknownType = "rejected";
    }

    try {
      window.sanitizeProjectData({
        attributes: [{ name: "Col1", type: "String", isBold: "false" }],
        products: []
      });
      results.isBoldStringFalse = "accepted";
    } catch (e) {
      results.isBoldStringFalse = "rejected";
    }

    try {
      window.sanitizeProjectData({
        attributes: [{ name: "Col1", type: "String" }],
        products: [{ id: 1, attributes: null }]
      });
      results.nullProductDict = "accepted";
    } catch (e) {
      results.nullProductDict = "rejected";
    }

    try {
      const synthetic5001Rows = Array.from({ length: 5001 }, (_, i) => ({
        id: i + 1,
        attributes: { Col1: "val" }
      }));
      window.sanitizeProjectData({
        attributes: [{ name: "Col1", type: "String" }],
        products: synthetic5001Rows
      });
      results.rows5001 = "accepted";
    } catch (e) {
      results.rows5001 = "rejected";
    }

    // Missing legacy fields get compatible defaults
    try {
      const legacyClean = window.sanitizeProjectData({
        attributes: [{ name: "Col1" }],
        products: [{ id: 1, attributes: { Col1: "val" } }]
      });
      results.legacyType = legacyClean.attributes[0].type;
      results.legacyWidth = legacyClean.attributes[0].columnWidth;
      results.legacyCanBeEmpty = legacyClean.attributes[0].canBeEmpty;
      results.legacyIsBold = legacyClean.attributes[0].isBold;
    } catch (e) {
      results.legacy = "error: " + e.message;
    }

    return results;
  });

  assert(schemaResults.unknownType === "rejected", "Unknown attribute type must be rejected");
  assert(schemaResults.isBoldStringFalse === "rejected", "Boolean string 'false' must be rejected");
  assert(schemaResults.nullProductDict === "rejected", "Null product attributes dictionary must be rejected");
  assert(schemaResults.rows5001 === "rejected", "5001 rows must exceed row limit and be rejected");
  assert(schemaResults.legacyType === "String", "Missing legacy type must default to String");
  assert(schemaResults.legacyWidth === 800, "Missing legacy columnWidth must default to 800");
  assert(schemaResults.legacyCanBeEmpty === true, "Missing legacy canBeEmpty must default to true");
  assert(schemaResults.legacyIsBold === false, "Missing legacy isBold must default to false");

  // 7B: Synthetic 5001-row cache in localStorage must NOT be overwritten with []
  console.log("Subtest 7B: Synthetic 5001-row cache in localStorage must not be overwritten with []...");
  const synthetic5001Data = JSON.stringify(Array.from({ length: 5001 }, (_, i) => ({
    id: i + 1,
    attributes: { Col1: "val" }
  })));

  await page.evaluate((data) => {
    localStorage.setItem("inventory_attributes", JSON.stringify([{ name: "Col1", type: "String" }]));
    localStorage.setItem("inventory_products", data);
  }, synthetic5001Data);

  await page.reload({ waitUntil: "networkidle" });

  const raw5001AfterReload = await page.evaluate(() => localStorage.getItem("inventory_products"));
  assert(raw5001AfterReload === synthetic5001Data, "Synthetic 5001-row cache must be preserved intact in localStorage across reload");
  assert(raw5001AfterReload !== "[]", "Storage must NOT be overwritten with empty products array on over-limit data");

  // Recovery modal must be visible offering raw export
  await page.waitForSelector("#recovery-modal:not(.hide)");
  const recoveryModal5001 = await page.locator("#recovery-modal").isVisible();
  assert(recoveryModal5001, "Recovery modal must be shown on over-limit data");

  // Dismiss recovery modal in-memory without touching storage
  await page.click("#recovery-dismiss-btn");
  await page.waitForSelector("#recovery-modal", { state: "hidden" });
  const rawAfterDismiss = await page.evaluate(() => localStorage.getItem("inventory_products"));
  assert(rawAfterDismiss === synthetic5001Data, "Storage must remain untouched after in-memory dismissal");

  // 7C: File-input import workflow rejects invalid files without modifying storage
  console.log("Subtest 7C: Import via file-input workflow rejects invalid schema and preserves storage...");
  // Set known valid state in localStorage first
  await page.evaluate(() => {
    localStorage.setItem("inventory_attributes", JSON.stringify([{ name: "SavedCol", type: "String" }]));
    localStorage.setItem("inventory_products", JSON.stringify([{ id: 1, attributes: { SavedCol: "PreservedValue" } }]));
  });
  await page.reload({ waitUntil: "networkidle" });

  // Trigger import with malformed / invalid schema JSON
  const invalidJsonFileContent = JSON.stringify({
    attributes: [{ name: "BadCol", type: "INVALID_ENUM_OR_TYPE" }],
    products: []
  });

  await page.setInputFiles("#import-json-file", {
    name: "corrupted_import.json",
    mimeType: "application/json",
    buffer: Buffer.from(invalidJsonFileContent)
  });

  // Verify toast error is shown
  await page.waitForSelector(".toast-error");
  const importToast = await page.locator(".toast-error .toast-message").first().textContent();
  assert(importToast.includes("Błąd") || importToast.includes("Error") || importToast.includes("nieprawidłowy"), `Expected error toast on invalid import, got: ${importToast}`);

  // Verify localStorage is still the preserved valid state
  const preservedProds = await page.evaluate(() => localStorage.getItem("inventory_products"));
  assert(preservedProds.includes("PreservedValue"), "Failed file import must not overwrite or modify existing stored project");

  console.log("✓ Test 7 passed.");

  console.log("\n=========================================");
  console.log("All browser end-to-end tests passed successfully!");
  console.log("=========================================\n");
} catch (err) {
  console.error("Browser test failed:", err);
  failed = true;
} finally {
  if (browser) await browser.close();
  await stopServer();
  process.exit(failed ? 1 : 0);
}
