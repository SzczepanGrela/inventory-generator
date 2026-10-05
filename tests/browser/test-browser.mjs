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
  const rawAfterExplicitReset = await page.evaluate(() => localStorage.getItem("inventory_products"));
  assert(JSON.parse(rawAfterExplicitReset).length === 0, "Explicit reset must deliberately replace storage with empty product list");
  const bannerHiddenAfterReset = await page.locator("#recovery-banner").isHidden();
  assert(bannerHiddenAfterReset, "Recovery banner must be hidden after explicit reset");

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
  const validStored = await page.evaluate(() => localStorage.getItem("inventory_products"));
  assert(validStored.includes("ImportedItemValue"), "Valid JSON import must successfully update stored products");
  const tableWithImport = await page.textContent("#inventory-tbody");
  assert(tableWithImport.includes("ImportedItemValue"), "Valid JSON import must update table DOM");

  // 7D: Failed default-template fetch during reset does not clear recovery
  console.log("Subtest 7D: Failed default template fetch during reset preserves recovery state...");
  const recContext = await browser.newContext();
  const recPage = await recContext.newPage({ viewport: { width: 1280, height: 800 } });
  await recPage.goto(baseUrl, { waitUntil: "networkidle" });
  await recPage.evaluate(() => {
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
  const rawAfterSuccessReset = await recPage.evaluate(() => localStorage.getItem("inventory_attributes"));
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
  const prodsAfterNetErr = await page.evaluate(() => localStorage.getItem("inventory_products"));
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
