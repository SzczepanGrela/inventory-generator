import { spawn } from "node:child_process";
import { chromium } from "playwright";
import nodeAssert from "node:assert";

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
assert.deepStrictEqual = nodeAssert.deepStrictEqual;
assert.strictEqual = nodeAssert.strictEqual;

let browser;
let failed = false;

try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("pageerror", (err) => console.error("PAGE ERROR:", err));
  page.on("console", (msg) => {
    if (msg.type() === "error") console.error("PAGE CONSOLE ERROR:", msg.text());
  });

  // -------------------------------------------------------------------------
  // TEST 1: Initial load, default attributes, and Local-First persistence
  // -------------------------------------------------------------------------
  console.log("Running Test 1: Initial load and Local-First persistence...");
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  
  // Verify empty state is visible initially
  const emptyStateVisible = await page.locator("#empty-state").isVisible();
  assert(emptyStateVisible, "Empty state should be displayed when product list is empty");

  // Verify attributes were loaded into memory / localStorage
  const savedProject = await page.evaluate(() => localStorage.getItem("inventory_project") || localStorage.getItem("inventory_attributes"));
  assert(savedProject !== null, "Default attributes/project must be stored in localStorage");
  const parsed = JSON.parse(savedProject);
  const parsedAttrs = parsed.attributes || parsed;
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
    localStorage.removeItem("inventory_project");
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

  const recoveredProject = await page.evaluate(() => localStorage.getItem("inventory_project") || localStorage.getItem("inventory_attributes"));
  assert(recoveredProject !== null, "Default project must be restored in localStorage after explicit reset");
  const parsedRec = JSON.parse(recoveredProject);
  const recAttrs = parsedRec.attributes || parsedRec;
  assert(recAttrs.length >= 5, "Default attributes must be restored in localStorage after explicit reset");
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
    localStorage.removeItem("inventory_project");
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

  // Test raw JSON recovery download and verify exact contents
  const [recDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.click("#recovery-download-btn")
  ]);
  assert(recDownload.suggestedFilename().includes("inventory_recovery_backup_"), "Recovery download filename must indicate raw backup");
  const recStream = await recDownload.createReadStream();
  const recChunks = [];
  for await (const chunk of recStream) {
    recChunks.push(chunk);
  }
  const recParsed = JSON.parse(Buffer.concat(recChunks).toString("utf-8"));
  assert(Array.isArray(recParsed.products) && recParsed.products.length === 5001, `Recovery backup must contain exactly 5001 product rows, got ${recParsed.products?.length}`);
  assert(recParsed._recoveryNotice, "Recovery backup must include recovery notice header");

  // Dismiss recovery modal in-memory without touching storage
  await page.click("#recovery-dismiss-btn");
  await page.waitForSelector("#recovery-modal", { state: "hidden" });
  const rawAfterDismiss = await page.evaluate(() => localStorage.getItem("inventory_products"));
  assert(rawAfterDismiss === synthetic5001Data, "Storage must remain untouched after in-memory dismissal");

  // Verify recovery banner is now visible in the layout offering a route back to recovery
  const bannerVisible = await page.locator("#recovery-banner").isVisible();
  assert(bannerVisible, "Recovery banner must be visible in layout after temporary dismissal");

  // IC04-1 Reproduction 1: Add product through form in temporary session
  console.log("Subtest 7B (IC04-1): Adding product via UI during temporary session must NOT overwrite 5001 rows in storage...");
  await page.click("#open-product-modal-btn");
  await page.waitForSelector("#product-modal:not(.hide)");
  const tempInputs = page.locator("#dynamic-fields-container input");
  const tempCount = await tempInputs.count();
  for (let i = 0; i < tempCount; i++) {
    const input = tempInputs.nth(i);
    const type = await input.getAttribute("type");
    if (type === "checkbox") {
      await input.check();
    } else if (type === "number") {
      await input.fill("42");
    } else if (type === "date") {
      await input.fill("2026-10-05");
    } else {
      await input.fill("Temporary Added Item");
    }
  }
  await page.click("#submit-product-btn");
  await page.waitForSelector("#product-modal", { state: "hidden" });

  // In-memory table displays the added product
  const tableContentTemp = await page.textContent("#inventory-tbody");
  assert(tableContentTemp.includes("Temporary Added Item"), "Temporary added item must appear in UI table");

  // BUT localStorage MUST still contain the preserved 5001 rows!
  const rawAfterAdd = await page.evaluate(() => localStorage.getItem("inventory_products"));
  assert(rawAfterAdd === synthetic5001Data, `Storage MUST preserve original 5001 rows after UI add! Got length: ${rawAfterAdd?.length}`);
  assert(rawAfterAdd !== "[]", "Storage must not be empty array");

  // Test language switch during temporary session preserves data
  await page.click("#lang-en-btn");
  await page.waitForTimeout(200);
  const rawAfterLangSwitch = await page.evaluate(() => localStorage.getItem("inventory_products"));
  assert(rawAfterLangSwitch === synthetic5001Data, "Storage must remain preserved after language switch in temporary session");
  await page.click("#lang-pl-btn");
  await page.waitForTimeout(200);

  // Test reopening recovery modal via banner button
  await page.click("#reopen-recovery-btn");
  await page.waitForSelector("#recovery-modal:not(.hide)");
  const reopenedModalVisible = await page.locator("#recovery-modal").isVisible();
  assert(reopenedModalVisible, "Clicking reopen recovery button in banner must display recovery modal");

  // Test reload during temporary session preserves data and re-presents recovery
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("#recovery-modal:not(.hide)");
  const rawAfterReloadAgain = await page.evaluate(() => localStorage.getItem("inventory_products"));
  assert(rawAfterReloadAgain === synthetic5001Data, "Storage must remain preserved across reloads until explicit reset");

  // Explicit user reset via button restores default template
  await page.click("#recovery-reset-btn");
  await page.waitForSelector("#recovery-modal", { state: "hidden" });
  const rawAfterExplicitReset = await page.evaluate(() => localStorage.getItem("inventory_project") || localStorage.getItem("inventory_products"));
  const parsedReset = JSON.parse(rawAfterExplicitReset);
  const resetProds = parsedReset.products !== undefined ? parsedReset.products : parsedReset;
  assert(resetProds.length === 0, "Explicit reset must deliberately replace storage with empty product list");
  const bannerHiddenAfterReset = await page.locator("#recovery-banner").isHidden();
  assert(bannerHiddenAfterReset, "Recovery banner must be hidden after explicit reset");

  // 7C: File-input import workflow rejects invalid files without modifying storage
  console.log("Subtest 7C: Import via file-input workflow rejects invalid schema and preserves storage...");
  // Set known valid state in localStorage first
  await page.evaluate(() => {
    localStorage.removeItem("inventory_project");
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
  const preservedProds = await page.evaluate(() => localStorage.getItem("inventory_project") || localStorage.getItem("inventory_products"));
  assert(preservedProds.includes("PreservedValue"), "Failed file import must not overwrite or modify existing stored project");

  // Verify valid JSON file import updates storage and UI
  const validJsonFileContent = JSON.stringify({
    attributes: [{ name: "ImportedCol", type: "String", columnWidth: 1000, canBeEmpty: true, isBold: false }],
    products: [{ id: 101, attributes: { ImportedCol: "ImportedItemValue" } }]
  });

  await page.setInputFiles("#import-json-file", {
    name: "valid_import.json",
    mimeType: "application/json",
    buffer: Buffer.from(validJsonFileContent)
  });

  await page.waitForTimeout(300);
  const validStored = await page.evaluate(() => localStorage.getItem("inventory_project") || localStorage.getItem("inventory_products"));
  assert(validStored.includes("ImportedItemValue"), "Valid JSON import must successfully update stored products");
  const tableWithImport = await page.textContent("#inventory-tbody");
  assert(tableWithImport.includes("ImportedItemValue"), "Valid JSON import must update table DOM");

  // 7D: Failed default-template fetch during reset does not clear recovery
  console.log("Subtest 7D: Failed default template fetch during reset preserves recovery state...");
  const recContext = await browser.newContext();
  const recPage = await recContext.newPage({ viewport: { width: 1280, height: 800 } });
  await recPage.goto(baseUrl, { waitUntil: "networkidle" });
  await recPage.evaluate(() => {
    localStorage.removeItem("inventory_project");
    localStorage.setItem("inventory_attributes", "corrupted-json{{");
    localStorage.setItem("inventory_products", "[]");
  });
  await recPage.reload({ waitUntil: "networkidle" });
  await recPage.waitForSelector("#recovery-modal:not(.hide)");

  // Intercept default attributes endpoint returning 500
  await recPage.route("**/api/attributes/default/**", (route) => {
    route.fulfill({ status: 500, body: "Internal Server Error" });
  });

  await recPage.click("#recovery-reset-btn");
  const failResetToastLocator = recPage.locator(".toast-error .toast-message", { hasText: /Błąd|Failed/ });
  await failResetToastLocator.waitFor({ state: "visible" });
  const failResetToast = await failResetToastLocator.textContent();
  assert(failResetToast.includes("Błąd") || failResetToast.includes("Failed"), `Expected error toast on failed reset, got: ${failResetToast}`);

  // Raw corrupted attributes MUST still be in localStorage (not wiped)
  const rawCorruptAfterFailedReset = await recPage.evaluate(() => localStorage.getItem("inventory_attributes"));
  assert(rawCorruptAfterFailedReset === "corrupted-json{{", "Failed reset must NOT modify or clear corrupted cache in localStorage");

  // Unroute and perform successful reset
  await recPage.unroute("**/api/attributes/default/**");
  await recPage.click("#recovery-reset-btn");
  await recPage.waitForSelector("#recovery-modal", { state: "hidden" });
  const rawAfterSuccessReset = await recPage.evaluate(() => localStorage.getItem("inventory_project") || localStorage.getItem("inventory_attributes"));
  assert(rawAfterSuccessReset !== "corrupted-json{{", "Successful reset must update attributes in localStorage");

  await recContext.close();

  // 7E: IC04-1 Reproduction 2: Fresh browser context without preference cookie preserves malformed attributes
  console.log("Subtest 7E: Fresh browser context without preference cookie preserves malformed attributes...");
  const freshContext = await browser.newContext();
  const freshPage = await freshContext.newPage({ viewport: { width: 1280, height: 800 } });
  await freshPage.goto(baseUrl, { waitUntil: "networkidle" });

  // Ensure no cookies exist and seed malformed attributes
  await freshPage.evaluate(() => {
    document.cookie = "inventory_is_edited=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
    localStorage.removeItem("inventory_project");
    localStorage.setItem("inventory_attributes", "bad-json{{");
    localStorage.setItem("inventory_products", "[]");
  });

  await freshPage.reload({ waitUntil: "networkidle" });

  // Recovery modal MUST be presented
  await freshPage.waitForSelector("#recovery-modal:not(.hide)");
  const freshModalVisible = await freshPage.locator("#recovery-modal").isVisible();
  assert(freshModalVisible, "Recovery modal must be visible on startup in fresh context without preference cookie");

  // Raw attributes MUST NOT have been overwritten by loadLanguage before recovery
  const freshRawAttrs = await freshPage.evaluate(() => localStorage.getItem("inventory_attributes"));
  assert(freshRawAttrs === "bad-json{{", `Malformed attributes must be preserved on startup, got: ${freshRawAttrs}`);

  await freshContext.close();

  // 7F: IC05F-1 Persistent write rejection during reset preserves complete original
  console.log("Subtest 7F: Persistent write rejection during reset preserves complete original...");
  const fContext = await browser.newContext();
  const fPage = await fContext.newPage({ viewport: { width: 1280, height: 800 } });
  await fPage.goto(baseUrl, { waitUntil: "networkidle" });
  
  const synthetic5001F = JSON.stringify(Array.from({ length: 5001 }, (_, i) => ({
    id: i + 1,
    attributes: { Col1: `Row${i + 1}` }
  })));
  const origAttrsF = JSON.stringify([{ name: "Col1", type: "String" }]);

  await fPage.evaluate(([attrs, prods]) => {
    localStorage.removeItem("inventory_project");
    localStorage.setItem("inventory_attributes", attrs);
    localStorage.setItem("inventory_products", prods);
  }, [origAttrsF, synthetic5001F]);

  await fPage.reload({ waitUntil: "networkidle" });
  await fPage.waitForSelector("#recovery-modal:not(.hide)");

  // Inject persistent failure on localStorage.setItem for project/products and all subsequent writes
  await fPage.evaluate(() => {
    const realSetItem = Storage.prototype.setItem;
    let failed = false;
    Storage.prototype.setItem = function (key, value) {
      if (this === localStorage && (failed || key === 'inventory_products' || key === 'inventory_project')) {
        failed = true;
        throw new DOMException('Injected persistent write failure', 'QuotaExceededError');
      }
      return realSetItem.call(this, key, value);
    };
  });

  // Attempt to reset to defaults
  await fPage.click("#recovery-reset-btn");

  // Storage full error toast must appear
  const fToastLocator = fPage.locator(".toast-error .toast-message", { hasText: /pełna|quota|Storage error|Błąd zapisu/i });
  await fToastLocator.waitFor({ state: "visible" });
  const fToastText = await fToastLocator.textContent();
  assert(fToastText.includes("pełna") || fToastText.includes("quota") || fToastText.includes("Storage error") || fToastText.includes("Błąd zapisu"), `Expected storage error toast, got: ${fToastText}`);

  // Crucial: NO success toast must appear!
  const hasSuccessToastF = await fPage.locator(".toast-info, .toast-success").count();
  assert(hasSuccessToastF === 0, "No success/info toast should be shown on storage failure");

  // Crucial: Recovery modal MUST still be visible!
  const fModalVisible = await fPage.locator("#recovery-modal").isVisible();
  assert(fModalVisible, "Recovery modal must remain visible after failed reset");

  // Crucial: Storage must be completely untouched (both attributes and products intact!)
  const fAttrsAfterFail = await fPage.evaluate(() => localStorage.getItem("inventory_attributes"));
  const fProdsAfterFail = await fPage.evaluate(() => localStorage.getItem("inventory_products"));
  const fProjAfterFail = await fPage.evaluate(() => localStorage.getItem("inventory_project"));
  assert(fAttrsAfterFail === origAttrsF, "Attributes must remain intact on write failure");
  assert(fProdsAfterFail === synthetic5001F, "Products must remain original 5001 rows on write failure");
  assert(fProjAfterFail === null, "No project key should be created on write failure");

  // Reload the page: recovery state must survive reload!
  await fPage.reload({ waitUntil: "networkidle" });
  await fPage.waitForSelector("#recovery-modal:not(.hide)");
  const fModalAfterReload = await fPage.locator("#recovery-modal").isVisible();
  assert(fModalAfterReload, "Recovery modal must still appear upon reload after failed reset");

  // Download recovery backup and verify BOTH attributes and 5001 rows are intact!
  const [fRecDownload] = await Promise.all([
    fPage.waitForEvent("download"),
    fPage.click("#recovery-download-btn")
  ]);
  const fChunks = [];
  for await (const chunk of await fRecDownload.createReadStream()) {
    fChunks.push(chunk);
  }
  const fRecParsed = JSON.parse(Buffer.concat(fChunks).toString("utf-8"));
  assert.deepStrictEqual(fRecParsed.attributes, JSON.parse(origAttrsF), "Recovery backup must contain complete original attributes");
  assert(fRecParsed.products?.length === 5001, `Recovery backup must still contain 5001 rows, got ${fRecParsed.products?.length}`);

  // Retry reset without injected failure: must succeed!
  await fPage.click("#recovery-reset-btn");
  await fPage.waitForSelector("#recovery-modal", { state: "hidden" });
  const fSuccessToast = await fPage.locator(".toast-info .toast-message").last().textContent();
  assert(fSuccessToast.includes("Zresetowano") || fSuccessToast.includes("reset"), `Expected reset success toast, got ${fSuccessToast}`);
  const fProjectAfterSuccess = await fPage.evaluate(() => localStorage.getItem("inventory_project"));
  const fParsedSuccess = JSON.parse(fProjectAfterSuccess);
  assert(Array.isArray(fParsedSuccess.products) && fParsedSuccess.products.length === 0, "Products should now be reset to empty array []");
  assert.strictEqual(await fPage.evaluate(() => localStorage.getItem("inventory_attributes")), null, "Legacy attributes key must be cleaned up");
  assert.strictEqual(await fPage.evaluate(() => localStorage.getItem("inventory_products")), null, "Legacy products key must be cleaned up");

  await fContext.close();

  // 7G: IC05F-1 Persistent write rejection during valid import preserves complete original
  console.log("Subtest 7G: Persistent write rejection during valid import preserves complete original...");
  const gContext = await browser.newContext();
  const gPage = await gContext.newPage({ viewport: { width: 1280, height: 800 } });
  await gPage.goto(baseUrl, { waitUntil: "networkidle" });

  await gPage.evaluate(([attrs, prods]) => {
    localStorage.removeItem("inventory_project");
    localStorage.setItem("inventory_attributes", attrs);
    localStorage.setItem("inventory_products", prods);
  }, [origAttrsF, synthetic5001F]);

  await gPage.reload({ waitUntil: "networkidle" });
  await gPage.waitForSelector("#recovery-modal:not(.hide)");

  // Temporarily dismiss recovery modal -> banner is shown
  await gPage.click("#recovery-dismiss-btn");
  await gPage.waitForSelector("#recovery-modal", { state: "hidden" });
  const gBannerVisible = await gPage.locator("#recovery-banner").isVisible();
  assert(gBannerVisible, "Recovery banner must be visible after temporary dismissal");

  // Inject persistent failure on localStorage.setItem
  await gPage.evaluate(() => {
    const realSetItem = Storage.prototype.setItem;
    let failed = false;
    Storage.prototype.setItem = function (key, value) {
      if (this === localStorage && (failed || key === 'inventory_products' || key === 'inventory_project')) {
        failed = true;
        throw new DOMException('Injected persistent write failure', 'QuotaExceededError');
      }
      return realSetItem.call(this, key, value);
    };
  });

  // Attempt import of valid JSON
  const validImportPayload = {
    attributes: [{ name: "ImportedCol", type: "String" }],
    products: [{ id: 1, attributes: { ImportedCol: "Value1" } }]
  };
  await gPage.setInputFiles("#import-json-file", {
    name: "valid-import.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(validImportPayload), "utf-8")
  });

  // Storage error toast must appear
  const gToastLocator = gPage.locator(".toast-error .toast-message", { hasText: /pełna|quota|Storage error|Błąd zapisu/i });
  await gToastLocator.waitFor({ state: "visible" });
  const gToastText = await gToastLocator.textContent();
  assert(gToastText.includes("pełna") || gToastText.includes("quota") || gToastText.includes("Storage error") || gToastText.includes("Błąd zapisu"), `Expected storage error toast on import, got ${gToastText}`);

  // Crucial: NO import success toast!
  const gSuccessToasts = await gPage.locator(".toast-success").count();
  assert(gSuccessToasts === 0, "No success toast should be shown when storage write fails during import");

  // Crucial: Recovery banner must STILL be visible!
  const gBannerAfterFail = await gPage.locator("#recovery-banner").isVisible();
  assert(gBannerAfterFail, "Recovery banner must remain visible when import fails to persist");

  // Crucial: Storage must be completely untouched (5001 rows and original attributes intact!)
  const gAttrsAfterFail = await gPage.evaluate(() => localStorage.getItem("inventory_attributes"));
  const gProdsAfterFail = await gPage.evaluate(() => localStorage.getItem("inventory_products"));
  const gProjAfterFail = await gPage.evaluate(() => localStorage.getItem("inventory_project"));
  assert(gAttrsAfterFail === origAttrsF, "Attributes must remain original on partial import write failure");
  assert(gProdsAfterFail === synthetic5001F, "Products must remain original 5001 rows on partial import write failure");
  assert(gProjAfterFail === null, "No project key should be created on failed import");

  // Reload page and download recovery backup: verify BOTH attributes and 5001 rows
  await gPage.reload({ waitUntil: "networkidle" });
  await gPage.waitForSelector("#recovery-modal:not(.hide)");
  const [gRecDownload] = await Promise.all([
    gPage.waitForEvent("download"),
    gPage.click("#recovery-download-btn")
  ]);
  const gChunks = [];
  for await (const chunk of await gRecDownload.createReadStream()) {
    gChunks.push(chunk);
  }
  const gRecParsed = JSON.parse(Buffer.concat(gChunks).toString("utf-8"));
  assert.deepStrictEqual(gRecParsed.attributes, JSON.parse(origAttrsF), "Recovery backup must contain complete original attributes after reload");
  assert(gRecParsed.products?.length === 5001, `Recovery backup must still contain 5001 rows after reload, got ${gRecParsed.products?.length}`);

  // Dismiss modal again to retry import without failure hook
  await gPage.click("#recovery-dismiss-btn");
  await gPage.waitForSelector("#recovery-modal", { state: "hidden" });

  // Retry import: must succeed!
  await gPage.setInputFiles("#import-json-file", {
    name: "valid-import.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(validImportPayload), "utf-8")
  });
  const importSuccessLocator = gPage.locator(".toast-success .toast-message", { hasText: /zaimportowany|imported/i });
  await importSuccessLocator.waitFor({ state: "visible" });
  const gProjectAfterSuccess = await gPage.evaluate(() => localStorage.getItem("inventory_project"));
  assert(gProjectAfterSuccess && gProjectAfterSuccess.includes("Value1"), "Project should now contain imported item");
  assert.strictEqual(await gPage.evaluate(() => localStorage.getItem("inventory_attributes")), null, "Legacy attributes must be removed");
  assert.strictEqual(await gPage.evaluate(() => localStorage.getItem("inventory_products")), null, "Legacy products must be removed");

  await gContext.close();

  // 7H: IC05F-1 Legacy migration failure on startup preserves complete original legacy data
  console.log("Subtest 7H: Legacy migration failure on startup preserves complete original legacy data...");
  const hContext = await browser.newContext();
  const hPage = await hContext.newPage({ viewport: { width: 1280, height: 800 } });

  // Install quota exception for inventory_project migration before initial page navigation
  await hPage.addInitScript(() => {
    const realSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, val) {
      if (this === localStorage && key === 'inventory_project') {
        throw new DOMException('Injected migration quota exceeded', 'QuotaExceededError');
      }
      return realSetItem.call(this, key, val);
    };
  });

  await hPage.goto(baseUrl, { waitUntil: "networkidle" });

  const legacyAttrsH = JSON.stringify([{ name: "LegacyCol", type: "String" }]);
  const legacyProdsH = JSON.stringify([{ id: 1, attributes: { LegacyCol: "LegacyValue" } }]);

  await hPage.evaluate(([attrs, prods]) => {
    localStorage.removeItem("inventory_project");
    localStorage.setItem("inventory_attributes", attrs);
    localStorage.setItem("inventory_products", prods);
  }, [legacyAttrsH, legacyProdsH]);

  // Reload page to trigger loadLocalData with migration hook active
  await hPage.reload({ waitUntil: "networkidle" });

  // App should load successfully into memory without crashing
  const tableContentH = await hPage.textContent("#inventory-tbody");
  assert(tableContentH.includes("LegacyValue"), "App must load legacy data into in-memory table even if migration write fails");

  // Storage: inventory_project failed to write, so legacy keys MUST remain intact!
  const hAttrs = await hPage.evaluate(() => localStorage.getItem("inventory_attributes"));
  const hProds = await hPage.evaluate(() => localStorage.getItem("inventory_products"));
  const hProj = await hPage.evaluate(() => localStorage.getItem("inventory_project"));
  assert.strictEqual(hAttrs, legacyAttrsH, "Legacy attributes must remain intact when migration fails");
  assert.strictEqual(hProds, legacyProdsH, "Legacy products must remain intact when migration fails");
  assert.strictEqual(hProj, null, "Project envelope must not be partially committed");

  // No error toast or corruption modal should be displayed for valid legacy data
  const hModalVisible = await hPage.locator("#recovery-modal").isVisible();
  assert(!hModalVisible, "Recovery modal should not be shown when legacy data is valid");

  await hContext.close();

  // 7I: Bilingual recovery dialog and accessible labels
  console.log("Subtest 7I: Bilingual recovery dialog and accessible labels...");
  const iContext = await browser.newContext();
  const iPage = await iContext.newPage({ viewport: { width: 1280, height: 800 } });
  await iPage.goto(baseUrl, { waitUntil: "networkidle" });

  await iPage.evaluate(() => {
    localStorage.removeItem("inventory_project");
    localStorage.setItem("inventory_attributes", "invalid-json{{");
    localStorage.setItem("inventory_products", "[]");
  });
  await iPage.reload({ waitUntil: "networkidle" });
  await iPage.waitForSelector("#recovery-modal:not(.hide)");

  // Switch to English
  await iPage.evaluate(() => changeLanguage('en'));
  await iPage.waitForTimeout(150);

  const enTitle = await iPage.locator("#recovery-title").textContent();
  assert(enTitle.includes("Problem detected with saved project"), `Expected EN title, got: ${enTitle}`);
  const enDownloadBtn = await iPage.locator("#recovery-download-btn").textContent();
  assert(enDownloadBtn.includes("Download emergency backup"), `Expected EN download btn, got: ${enDownloadBtn}`);
  const enResetBtn = await iPage.locator("#recovery-reset-btn").textContent();
  assert(enResetBtn.includes("Reset to defaults"), `Expected EN reset btn, got: ${enResetBtn}`);
  const enDismissBtn = await iPage.locator("#recovery-dismiss-btn").textContent();
  assert(enDismissBtn.includes("Keep in memory only"), `Expected EN dismiss btn, got: ${enDismissBtn}`);

  // Dismiss recovery modal in EN
  await iPage.click("#recovery-dismiss-btn");
  await iPage.waitForSelector("#recovery-modal", { state: "hidden" });
  const enAriaLabel = await iPage.locator("#reopen-recovery-btn").getAttribute("aria-label");
  assert(enAriaLabel === "Open data recovery options", `Expected EN aria-label on banner button, got: ${enAriaLabel}`);

  // Switch back to Polish
  await iPage.evaluate(() => changeLanguage('pl'));
  await iPage.waitForTimeout(150);
  const plAriaLabel = await iPage.locator("#reopen-recovery-btn").getAttribute("aria-label");
  assert(plAriaLabel === "Otwórz opcje odzyskiwania danych", `Expected PL aria-label on banner button, got: ${plAriaLabel}`);

  await iContext.close();

  // -------------------------------------------------------------------------
  // Subtest 7J: IC07-1 Recovery download preserves raw authoritative project
  // byte-for-byte on truncated, empty, and invalid-structure values without
  // mutating storage or falling back to stale legacy data
  // -------------------------------------------------------------------------
  console.log("Subtest 7J (IC07-1): Preserving raw authoritative project in recovery download...");
  const jContext = await browser.newContext();
  const jPage = await jContext.newPage({ viewport: { width: 1280, height: 800 } });
  await jPage.goto(baseUrl, { waitUntil: "networkidle" });

  // Helper to trigger and read recovery download
  async function downloadAndParseRecoveryBackup(pageInstance) {
    const [download] = await Promise.all([
      pageInstance.waitForEvent("download"),
      pageInstance.click("#recovery-download-btn")
    ]);
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
  }

  // 7J.1: Truncated authoritative JSON value
  const truncatedRaw = '{"version":1,"attributes":[{"name":"Saved","type":"String"}],"products":[{"id":1';
  const staleLegacyAttrs = JSON.stringify([{ name: "StaleCol", type: "String" }]);
  const staleLegacyProds = JSON.stringify([{ id: 999, attributes: { StaleCol: "StaleVal" } }]);

  await jPage.evaluate(([rawProj, legAttrs, legProds]) => {
    localStorage.setItem("inventory_project", rawProj);
    localStorage.setItem("inventory_attributes", legAttrs);
    localStorage.setItem("inventory_products", legProds);
  }, [truncatedRaw, staleLegacyAttrs, staleLegacyProds]);

  await jPage.reload({ waitUntil: "networkidle" });
  await jPage.waitForSelector("#recovery-modal:not(.hide)");

  const recParsedTrunc = await downloadAndParseRecoveryBackup(jPage);
  assert.strictEqual(recParsedTrunc.rawProject, truncatedRaw, "Recovery backup must preserve exact truncated authoritative string byte-for-byte");
  assert.strictEqual(recParsedTrunc.rawAuthoritativeProject, truncatedRaw, "rawAuthoritativeProject must match truncated string byte-for-byte");
  assert.strictEqual(recParsedTrunc.attributes, null, "Extracted attributes must be null when JSON is truncated");
  assert.strictEqual(recParsedTrunc.products, null, "Extracted products must be null when JSON is truncated");

  const storageAfterTruncDownload = await jPage.evaluate(() => localStorage.getItem("inventory_project"));
  assert.strictEqual(storageAfterTruncDownload, truncatedRaw, "Storage must not be mutated by downloading recovery backup");

  const tableTextTrunc = await jPage.textContent("#inventory-tbody");
  assert(!tableTextTrunc.includes("StaleVal"), "Stale legacy data must not be loaded into memory when authoritative project is present");

  // 7J.2: Valid JSON with invalid structure
  const invalidStructureRaw = '{"version":1,"attributes":"not-an-array","products":null}';
  await jPage.evaluate(([rawProj, legAttrs, legProds]) => {
    localStorage.setItem("inventory_project", rawProj);
    localStorage.setItem("inventory_attributes", legAttrs);
    localStorage.setItem("inventory_products", legProds);
  }, [invalidStructureRaw, staleLegacyAttrs, staleLegacyProds]);

  await jPage.reload({ waitUntil: "networkidle" });
  await jPage.waitForSelector("#recovery-modal:not(.hide)");

  const recParsedInvalid = await downloadAndParseRecoveryBackup(jPage);
  assert.strictEqual(recParsedInvalid.rawProject, invalidStructureRaw, "Recovery backup must preserve invalid structure raw string byte-for-byte");
  assert.strictEqual(recParsedInvalid.rawAuthoritativeProject, invalidStructureRaw, "rawAuthoritativeProject must match invalid structure raw string");
  assert.strictEqual(recParsedInvalid.attributes, null, "Extracted attributes must be null when structure is invalid");
  assert.strictEqual(recParsedInvalid.products, null, "Extracted products must be null when structure is invalid");

  const storageAfterInvalidDownload = await jPage.evaluate(() => localStorage.getItem("inventory_project"));
  assert.strictEqual(storageAfterInvalidDownload, invalidStructureRaw, "Storage must not be mutated by downloading recovery backup");

  // 7J.3: Empty authoritative string
  const emptyRaw = "";
  await jPage.evaluate(([rawProj, legAttrs, legProds]) => {
    localStorage.setItem("inventory_project", rawProj);
    localStorage.setItem("inventory_attributes", legAttrs);
    localStorage.setItem("inventory_products", legProds);
  }, [emptyRaw, staleLegacyAttrs, staleLegacyProds]);

  await jPage.reload({ waitUntil: "networkidle" });
  await jPage.waitForSelector("#recovery-modal:not(.hide)");

  const recParsedEmpty = await downloadAndParseRecoveryBackup(jPage);
  assert.strictEqual(recParsedEmpty.rawProject, "", "Recovery backup must preserve empty authoritative string byte-for-byte");
  assert.strictEqual(recParsedEmpty.rawAuthoritativeProject, "", "rawAuthoritativeProject must match empty string");
  assert.strictEqual(recParsedEmpty.attributes, null, "Attributes must be null for empty authoritative string");
  assert.strictEqual(recParsedEmpty.products, null, "Products must be null for empty authoritative string");

  const storageAfterEmptyDownload = await jPage.evaluate(() => localStorage.getItem("inventory_project"));
  assert.strictEqual(storageAfterEmptyDownload, "", "Storage must not be mutated by downloading recovery backup");

  // 7J.4: Valid over-limit envelope preserves all attributes, rows, and raw envelope
  const overLimitEnvelope = JSON.stringify({
    version: 1,
    attributes: [{ name: "ColOver", type: "String" }],
    products: Array.from({ length: 5001 }, (_, i) => ({
      id: i + 1,
      attributes: { ColOver: `Val${i + 1}` }
    }))
  });
  await jPage.evaluate(([rawProj]) => {
    localStorage.setItem("inventory_project", rawProj);
    localStorage.removeItem("inventory_attributes");
    localStorage.removeItem("inventory_products");
  }, [overLimitEnvelope]);

  await jPage.reload({ waitUntil: "networkidle" });
  await jPage.waitForSelector("#recovery-modal:not(.hide)");

  const recParsedOver = await downloadAndParseRecoveryBackup(jPage);
  assert.strictEqual(recParsedOver.rawProject, overLimitEnvelope, "Recovery backup must preserve complete raw over-limit envelope");
  assert(Array.isArray(recParsedOver.attributes) && recParsedOver.attributes.length === 1, "Export must include attributes as convenience field");
  assert(Array.isArray(recParsedOver.products) && recParsedOver.products.length === 5001, "Export must include all 5001 products as convenience field");

  const storageAfterOverDownload = await jPage.evaluate(() => localStorage.getItem("inventory_project"));
  assert.strictEqual(storageAfterOverDownload, overLimitEnvelope, "Storage must remain untouched after download");

  await jContext.close();

  console.log("✓ Test 7 passed.");

  // -------------------------------------------------------------------------
  // TEST 8: IC03-5 Export Downloads (CSV, DOCX, HTML, Project JSON)
  // -------------------------------------------------------------------------
  console.log("Running Test 8: IC03-5 Export downloads (CSV, DOCX, HTML, JSON)...");

  // 8A: Export CSV download
  await page.click("#export-dropdown-btn");
  await page.click("#export-csv-btn");
  await page.waitForSelector("#preview-modal:not(.hide)");

  const [csvDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.click("#modal-download-btn")
  ]);
  assert(csvDownload.suggestedFilename().endsWith(".csv"), `Expected .csv extension, got: ${csvDownload.suggestedFilename()}`);
  const csvStream = await csvDownload.createReadStream();
  const csvChunks = [];
  for await (const chunk of csvStream) {
    csvChunks.push(chunk);
  }
  const csvText = Buffer.concat(csvChunks).toString("utf-8");
  assert(csvText.includes("ImportedCol") && csvText.includes("ImportedItemValue"), "CSV export must contain exported column and row data");
  await page.waitForSelector("#preview-modal", { state: "hidden" });

  // 8B: Export DOCX download
  await page.click("#export-dropdown-btn");
  await page.click("#export-docx-btn");
  await page.waitForSelector("#preview-modal:not(.hide)");

  const [docxDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.click("#modal-download-btn")
  ]);
  assert(docxDownload.suggestedFilename().endsWith(".docx"), `Expected .docx extension, got: ${docxDownload.suggestedFilename()}`);
  const docxStream = await docxDownload.createReadStream();
  let docxBytes = 0;
  for await (const chunk of docxStream) {
    docxBytes += chunk.length;
  }
  assert(docxBytes > 500, `DOCX payload must be non-empty (got ${docxBytes} bytes)`);
  await page.waitForSelector("#preview-modal", { state: "hidden" });

  // 8C: Export HTML download
  await page.click("#export-dropdown-btn");
  await page.click("#export-html-btn");
  await page.waitForSelector("#preview-modal:not(.hide)");

  const [htmlDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.click("#modal-download-btn")
  ]);
  assert(htmlDownload.suggestedFilename().endsWith(".html"), `Expected .html extension, got: ${htmlDownload.suggestedFilename()}`);
  const htmlStream = await htmlDownload.createReadStream();
  const htmlChunks = [];
  for await (const chunk of htmlStream) {
    htmlChunks.push(chunk);
  }
  const htmlText = Buffer.concat(htmlChunks).toString("utf-8");
  assert(htmlText.includes("ImportedCol") && htmlText.includes("ImportedItemValue"), "HTML export must contain table headers and rows");
  await page.waitForSelector("#preview-modal", { state: "hidden" });

  // 8D: Project JSON export
  const [jsonExport] = await Promise.all([
    page.waitForEvent("download"),
    page.click("#export-json-btn")
  ]);
  assert(jsonExport.suggestedFilename().endsWith(".json"), `Expected .json extension, got: ${jsonExport.suggestedFilename()}`);
  const jsonStream = await jsonExport.createReadStream();
  const jsonChunks = [];
  for await (const chunk of jsonStream) {
    jsonChunks.push(chunk);
  }
  const jsonParsed = JSON.parse(Buffer.concat(jsonChunks).toString("utf-8"));
  assert(jsonParsed.attributes && jsonParsed.products, "Exported JSON must contain attributes and products");
  assert(jsonParsed.products[0].attributes.ImportedCol === "ImportedItemValue", "Exported JSON must contain valid project row values");
  console.log("✓ Test 8 passed.");

  // -------------------------------------------------------------------------
  // TEST 9: IC03-5 Responsive Mobile Viewport Layout (375x667)
  // -------------------------------------------------------------------------
  console.log("Running Test 9: IC03-5 Responsive mobile viewport layout (375x667)...");
  await page.setViewportSize({ width: 375, height: 667 });
  await page.waitForTimeout(200);

  // Check that .hide-mobile text elements are hidden on mobile
  const isExportLabelVisible = await page.locator("#export-dropdown-btn .hide-mobile").isVisible();
  assert(!isExportLabelVisible, ".hide-mobile text must not be visible on 375px mobile viewport");

  // Check that page content does not cause horizontal body overflow
  const hasNoDocOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  assert(hasNoDocOverflow, "Mobile layout must fit within 375px viewport without horizontal document overflow");

  // Restore desktop viewport
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(200);
  console.log("✓ Test 9 passed.");

  // -------------------------------------------------------------------------
  // TEST 10: IC03-5 Modal Tab Focus Trapping and Focus Restoration
  // -------------------------------------------------------------------------
  console.log("Running Test 10: IC03-5 Modal Tab focus trapping and focus restoration...");
  await page.focus("#settings-modal-trigger-btn");
  await page.keyboard.press("Enter");
  await page.waitForSelector("#settings-modal:not(.hide)");

  // Verify initial focus is inside modal (await animation frame focus shift)
  await page.waitForFunction(() => document.querySelector("#settings-modal")?.contains(document.activeElement));
  const initialInside = await page.evaluate(() => document.querySelector("#settings-modal")?.contains(document.activeElement));
  assert(initialInside, "Initial focus upon opening modal must be inside #settings-modal");

  // Focus the last interactive element directly and test forward Tab wrapping
  await page.evaluate(() => {
    const modal = document.querySelector("#settings-modal");
    const focusable = Array.from(modal.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter((el) => el.offsetParent !== null);
    focusable[focusable.length - 1].focus();
  });

  await page.keyboard.press("Tab");
  const isFirstActive = await page.evaluate(() => {
    const modal = document.querySelector("#settings-modal");
    const focusable = Array.from(modal.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter((el) => el.offsetParent !== null);
    return document.activeElement === focusable[0];
  });
  assert(isFirstActive, "Tabbing forward from last element must trap focus back to first element");

  // From first element, test backward Shift+Tab wrapping
  await page.keyboard.press("Shift+Tab");
  const isLastActive = await page.evaluate(() => {
    const modal = document.querySelector("#settings-modal");
    const focusable = Array.from(modal.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter((el) => el.offsetParent !== null);
    return document.activeElement === focusable[focusable.length - 1];
  });
  assert(isLastActive, "Shift+Tabbing backward from first element must trap focus to last element");

  // Close modal via Escape and verify focus restoration to trigger button
  await page.keyboard.press("Escape");
  await page.waitForSelector("#settings-modal", { state: "hidden" });
  await page.waitForFunction(() => document.activeElement?.id === "settings-modal-trigger-btn");
  const restoredId = await page.evaluate(() => document.activeElement?.id);
  assert(restoredId === "settings-modal-trigger-btn", `Focus must be restored to trigger button (#settings-modal-trigger-btn), got #${restoredId}`);
  console.log("✓ Test 10 passed.");

  // -------------------------------------------------------------------------
  // TEST 11: IC03-5 HTTP 429 Button Locking and Automatic Cooldown Recovery
  // -------------------------------------------------------------------------
  console.log("Running Test 11: IC03-5 HTTP 429 button locking and cooldown recovery...");
  await page.route("**/api/export/**", async (route) => {
    await route.fulfill({
      status: 429,
      headers: {
        "Retry-After": "2",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ detail: "Zbyt wiele żądań eksportu." })
    });
  });

  await page.click("#export-dropdown-btn");
  await page.click("#export-csv-btn");
  await page.waitForSelector("#preview-modal:not(.hide)");

  // Click download triggering 429 response
  await page.click("#modal-download-btn");

  // Verify rate limit toast is shown and download button is locked
  await page.waitForSelector("#rate-limit-toast");
  const isLocked = await page.locator("#modal-download-btn").isDisabled();
  assert(isLocked, "Download button must be locked (disabled) when 429 is received");

  // Wait 2.5s for cooldown to complete
  await page.waitForTimeout(2500);
  const toastRemaining = await page.locator("#rate-limit-toast").count();
  assert(toastRemaining === 0, "Rate limit toast must disappear after countdown completes");
  const isUnlocked = await page.locator("#modal-download-btn").isEnabled();
  assert(isUnlocked, "Download button must be re-enabled after cooldown period");

  await page.unroute("**/api/export/**");
  await page.click("#modal-close-btn");
  await page.waitForSelector("#preview-modal", { state: "hidden" });
  console.log("✓ Test 11 passed.");

  // -------------------------------------------------------------------------
  // TEST 12: IC03-5 Network Error Resilience
  // -------------------------------------------------------------------------
  console.log("Running Test 12: IC03-5 Network error resilience...");
  await page.route("**/api/export/**", async (route) => {
    await route.abort("failed");
  });

  await page.click("#export-dropdown-btn");
  await page.click("#export-csv-btn");
  await page.waitForSelector("#preview-modal:not(.hide)");

  await page.click("#modal-download-btn");

  // Verify error toast appears
  await page.waitForSelector(".toast-error");
  const errToastText = await page.locator(".toast-error .toast-message").last().textContent();
  assert(errToastText.includes("Export error:"), `Expected export error toast, got: "${errToastText}"`);

  // Verify application state and localStorage remain intact
  const prodsAfterNetErr = await page.evaluate(() => localStorage.getItem("inventory_project") || localStorage.getItem("inventory_products"));
  assert(prodsAfterNetErr !== null && prodsAfterNetErr.includes("ImportedItemValue"), "Stored products must remain intact after network error");

  await page.unroute("**/api/export/**");
  await page.click("#modal-close-btn");
  await page.waitForSelector("#preview-modal", { state: "hidden" });
  console.log("✓ Test 12 passed.");

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
