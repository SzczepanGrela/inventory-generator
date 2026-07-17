// Application State
let appState = {
  attributes: [],
  products: [],
  editingProductId: null,
  currentLanguage: localStorage.getItem('inventory_lang') || 'pl',
  translations: {},
  currentTheme: localStorage.getItem('inventory_theme') || 'light',
  currentExportFormat: null,
  apiBase: window.location.origin
};

// DOM Elements
const elements = {
  htmlElement: document.documentElement,
  dynamicFieldsContainer: document.getElementById('dynamic-fields-container'),
  productForm: document.getElementById('product-form'),
  formTitle: document.getElementById('form-title'),
  submitProductBtn: document.getElementById('submit-product-btn'),
  cancelEditBtn: document.getElementById('cancel-edit-btn'),
  
  inventoryTableContainer: document.getElementById('inventory-table-container'),
  inventoryMainTable: document.getElementById('inventory-main-table'),
  inventoryThead: document.getElementById('inventory-thead'),
  inventoryTbody: document.getElementById('inventory-tbody'),
  emptyState: document.getElementById('empty-state'),
  productCountBadge: document.getElementById('product-count-badge'),
  
  attributesToggle: document.getElementById('attributes-toggle'),
  attributesPanel: document.getElementById('attributes-panel'),
  attributesListBody: document.getElementById('attributes-list-body'),
  
  // New Attribute Inputs
  newAttrName: document.getElementById('new-attr-name'),
  newAttrType: document.getElementById('new-attr-type'),
  newAttrEnumGroup: document.getElementById('enum-values-group'),
  newAttrEnum: document.getElementById('new-attr-enum'),
  newAttrWidth: document.getElementById('new-attr-width'),
  newAttrEmpty: document.getElementById('new-attr-empty'),
  newAttrBold: document.getElementById('new-attr-bold'),
  addAttributeBtn: document.getElementById('add-attribute-btn'),
  
  // Actions
  saveAttributesBtn: document.getElementById('save-attributes-btn'),
  resetAttributesBtn: document.getElementById('reset-attributes-btn'),
  clearAllBtn: document.getElementById('clear-all-btn'),
  exportDocxBtn: document.getElementById('export-docx-btn'),
  exportCsvBtn: document.getElementById('export-csv-btn'),
  exportHtmlBtn: document.getElementById('export-html-btn'),
  
  // JSON Backup Actions
  exportJsonBtn: document.getElementById('export-json-btn'),
  importJsonTriggerBtn: document.getElementById('import-json-trigger-btn'),
  importJsonFile: document.getElementById('import-json-file'),
  
  // Translation Switches
  langPlBtn: document.getElementById('lang-pl-btn'),
  langEnBtn: document.getElementById('lang-en-btn'),
  
  // Theme Switches
  themeToggleBtn: document.getElementById('theme-toggle-btn'),
  
  // Modal Preview Elements
  previewModal: document.getElementById('preview-modal'),
  closeModalBtn: document.getElementById('close-modal-btn'),
  modalCloseBtn: document.getElementById('modal-close-btn'),
  modalDownloadBtn: document.getElementById('modal-download-btn'),
  documentPreviewContainer: document.getElementById('document-preview-container'),
  
  toastContainer: document.getElementById('toast-container')
};

// Initialize Application
document.addEventListener('DOMContentLoaded', async () => {
  setTheme(appState.currentTheme);
  await loadLanguage(appState.currentLanguage);
  setupEventListeners();
  await loadData();
});

// Setup Event Listeners
function setupEventListeners() {
  // Collapsible settings panel toggle
  elements.attributesToggle.addEventListener('click', () => {
    elements.attributesPanel.classList.toggle('collapsed');
  });

  // Dynamic Type Selection -> Show/Hide Enum Field
  elements.newAttrType.addEventListener('change', (e) => {
    if (e.target.value === 'Enum') {
      elements.newAttrEnumGroup.style.display = 'flex';
    } else {
      elements.newAttrEnumGroup.style.display = 'none';
    }
  });

  // Add attribute locally
  elements.addAttributeBtn.addEventListener('click', addAttributeLocally);

  // Reset and Save Attributes settings
  elements.saveAttributesBtn.addEventListener('click', saveAttributesToServer);
  elements.resetAttributesBtn.addEventListener('click', resetAttributesToDefault);

  // Form Submission
  elements.productForm.addEventListener('submit', handleFormSubmit);
  elements.cancelEditBtn.addEventListener('click', exitEditMode);

  // Clear database data
  elements.clearAllBtn.addEventListener('click', clearAllProducts);

  // Export buttons (Trigger Preview Modal)
  elements.exportDocxBtn.addEventListener('click', () => openPreviewModal('docx'));
  elements.exportCsvBtn.addEventListener('click', () => openPreviewModal('csv'));
  elements.exportHtmlBtn.addEventListener('click', () => openPreviewModal('html'));

  // JSON backup actions
  elements.exportJsonBtn.addEventListener('click', exportProjectAsJson);
  elements.importJsonTriggerBtn.addEventListener('click', () => elements.importJsonFile.click());
  elements.importJsonFile.addEventListener('change', importProjectFromJson);

  // Language selectors
  elements.langPlBtn.addEventListener('click', () => changeLanguage('pl'));
  elements.langEnBtn.addEventListener('click', () => changeLanguage('en'));

  // Theme switch button
  elements.themeToggleBtn.addEventListener('click', toggleTheme);

  // Modal actions
  elements.closeModalBtn.addEventListener('click', closePreviewModal);
  elements.modalCloseBtn.addEventListener('click', closePreviewModal);
  elements.modalDownloadBtn.addEventListener('click', executeDownload);
}

// ----------------------------------------------------
// TRANSLATION ENGINE (i18n)
// ----------------------------------------------------
async function loadLanguage(lang) {
  try {
    const response = await fetch(`${appState.apiBase}/locales/${lang}.json`);
    if (!response.ok) throw new Error(`Could not load translations for: ${lang}`);
    appState.translations = await response.json();
    appState.currentLanguage = lang;
    localStorage.setItem('inventory_lang', lang);
    translatePage();
    updateLangUI();
  } catch (error) {
    console.error('i18n error:', error);
  }
}

function translatePage() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const translation = appState.translations[key];
    if (translation) {
      if (el.tagName === 'INPUT' && el.type === 'text') {
        el.placeholder = translation;
      } else {
        el.innerText = translation;
      }
    }
  });

  // Refresh dynamic parts
  if (appState.attributes.length > 0) {
    renderUI();
  }
}

function getTranslation(key) {
  return appState.translations[key] || key;
}

function changeLanguage(lang) {
  if (appState.currentLanguage === lang) return;
  loadLanguage(lang);
}

function updateLangUI() {
  if (appState.currentLanguage === 'pl') {
    elements.langPlBtn.classList.add('active');
    elements.langEnBtn.classList.remove('active');
  } else {
    elements.langEnBtn.classList.add('active');
    elements.langPlBtn.classList.remove('active');
  }
}

// Format the localized item count badge
function getLocalizedProductBadge(count) {
  if (appState.currentLanguage === 'pl') {
    if (count === 1) return `1 ${getTranslation('items_badge_one')}`;
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
      return `${count} ${getTranslation('items_badge_few')}`;
    }
    return `${count} ${getTranslation('items_badge_many')}`;
  } else {
    // English
    if (count === 1) return `1 item`;
    return `${count} items`;
  }
}

// ----------------------------------------------------
// THEME SWITCHER
// ----------------------------------------------------
function toggleTheme() {
  const newTheme = appState.currentTheme === 'light' ? 'dark' : 'light';
  setTheme(newTheme);
}

function setTheme(theme) {
  appState.currentTheme = theme;
  elements.htmlElement.setAttribute('data-theme', theme);
  localStorage.setItem('inventory_theme', theme);
}

// ----------------------------------------------------
// DATA SERVICE & API LOGIC
// ----------------------------------------------------
async function loadData() {
  try {
    const attrResponse = await fetch(`${appState.apiBase}/api/attributes`);
    if (attrResponse.ok) {
      appState.attributes = await attrResponse.json();
    }
    
    const prodResponse = await fetch(`${appState.apiBase}/api/products`);
    if (prodResponse.ok) {
      appState.products = await prodResponse.json();
    }

    renderUI();
  } catch (error) {
    showToast(getTranslation('toast_disconnected'), 'error');
    console.error(error);
  }
}

function renderUI() {
  renderDynamicForm();
  renderInventoryTable();
  renderAttributesSettings();
}

// Build form inputs based on settings columns
function renderDynamicForm() {
  elements.dynamicFieldsContainer.innerHTML = '';
  
  appState.attributes.forEach(attr => {
    const formGroup = document.createElement('div');
    formGroup.className = 'form-group';

    const label = document.createElement('label');
    label.setAttribute('for', `field-${attr.name}`);
    label.innerText = attr.name;
    formGroup.appendChild(label);

    const isRequired = !attr.canBeEmpty ? 'required' : '';
    let input;

    if (attr.type === 'Enum') {
      input = document.createElement('select');
      input.id = `field-${attr.name}`;
      if (attr.canBeEmpty) {
        const emptyOption = document.createElement('option');
        emptyOption.value = '';
        emptyOption.innerText = getTranslation('opt_choose');
        input.appendChild(emptyOption);
      }
      attr.enumValues.forEach(val => {
        const option = document.createElement('option');
        option.value = val.trim();
        option.innerText = val.trim();
        input.appendChild(option);
      });
    } else if (attr.type === 'Bool') {
      const checkboxWrap = document.createElement('div');
      checkboxWrap.className = 'checkbox-wrapper';
      
      input = document.createElement('input');
      input.type = 'checkbox';
      input.id = `field-${attr.name}`;
      
      const checkLabel = document.createElement('label');
      checkLabel.setAttribute('for', `field-${attr.name}`);
      checkLabel.innerText = getTranslation('opt_yes');
      
      checkboxWrap.appendChild(input);
      checkboxWrap.appendChild(checkLabel);
      formGroup.appendChild(checkboxWrap);
      elements.dynamicFieldsContainer.appendChild(formGroup);
      return;
    } else {
      input = document.createElement('input');
      input.id = `field-${attr.name}`;
      
      if (attr.type === 'Int') {
        input.type = 'number';
        input.step = '1';
      } else if (attr.type === 'Double') {
        input.type = 'number';
        input.step = '0.01';
      } else if (attr.type === 'DateTime') {
        input.type = 'date';
      } else {
        input.type = 'text';
      }
      
      if (isRequired) input.setAttribute('required', 'true');
    }

    formGroup.appendChild(input);
    elements.dynamicFieldsContainer.appendChild(formGroup);
  });
}

// Render main records table
function renderInventoryTable() {
  elements.inventoryThead.innerHTML = '';
  elements.inventoryTbody.innerHTML = '';

  const count = appState.products.length;
  elements.productCountBadge.innerText = getLocalizedProductBadge(count);

  if (count === 0) {
    elements.emptyState.style.display = 'flex';
    elements.inventoryMainTable.style.display = 'none';
    return;
  }

  elements.emptyState.style.display = 'none';
  elements.inventoryMainTable.style.display = 'table';

  const headerTr = document.createElement('tr');
  
  // ID Header
  const idTh = document.createElement('th');
  idTh.innerText = 'ID';
  idTh.style.width = '60px';
  headerTr.appendChild(idTh);

  // Dynamic headers
  appState.attributes.forEach(attr => {
    const th = document.createElement('th');
    th.innerText = attr.name;
    if (isNumericType(attr.type)) {
      th.className = 'text-align-right';
    }
    headerTr.appendChild(th);
  });

  // Actions Header
  const actionsTh = document.createElement('th');
  actionsTh.innerText = getTranslation('col_action');
  actionsTh.style.width = '100px';
  headerTr.appendChild(actionsTh);
  elements.inventoryThead.appendChild(headerTr);

  // Data Rows
  appState.products.forEach(prod => {
    const tr = document.createElement('tr');
    
    const idTd = document.createElement('td');
    idTd.innerText = prod.id;
    tr.appendChild(idTd);

    appState.attributes.forEach(attr => {
      const td = document.createElement('td');
      const val = prod.attributes[attr.name];
      
      if (attr.type === 'Bool') {
        td.innerText = val === true ? getTranslation('opt_yes') : getTranslation('opt_no');
      } else if (attr.type === 'DateTime' && val) {
        td.innerText = new Date(val).toLocaleDateString();
      } else {
        td.innerText = val !== null && val !== undefined ? val : '';
      }

      if (isNumericType(attr.type)) {
        td.className = 'text-align-right';
      }
      if (attr.isBold) {
        td.classList.add('font-bold');
      }

      tr.appendChild(td);
    });

    const actionsTd = document.createElement('td');
    actionsTd.className = 'row-actions';
    
    const editBtn = document.createElement('button');
    editBtn.className = 'btn-row-action btn-edit-row';
    editBtn.innerHTML = '<i class="fa-solid fa-pencil"></i>';
    editBtn.addEventListener('click', () => enterEditMode(prod));
    
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-row-action btn-delete-row';
    deleteBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
    deleteBtn.addEventListener('click', () => deleteProduct(prod.id));

    actionsTd.appendChild(editBtn);
    actionsTd.appendChild(deleteBtn);
    tr.appendChild(actionsTd);

    elements.inventoryTbody.appendChild(tr);
  });
}

// Render configuration list
function renderAttributesSettings() {
  elements.attributesListBody.innerHTML = '';

  appState.attributes.forEach((attr, idx) => {
    const tr = document.createElement('tr');
    
    const nameTd = document.createElement('td');
    nameTd.innerText = attr.name;
    tr.appendChild(nameTd);

    const typeTd = document.createElement('td');
    typeTd.innerHTML = `<span class="badge">${attr.type}</span>`;
    tr.appendChild(typeTd);

    const emptyTd = document.createElement('td');
    emptyTd.innerText = attr.canBeEmpty ? getTranslation('opt_yes') : getTranslation('opt_no');
    tr.appendChild(emptyTd);

    const widthTd = document.createElement('td');
    widthTd.innerText = attr.columnWidth;
    tr.appendChild(widthTd);

    const boldTd = document.createElement('td');
    boldTd.innerText = attr.isBold ? getTranslation('opt_yes') : getTranslation('opt_no');
    tr.appendChild(boldTd);

    const actionTd = document.createElement('td');
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-row-action btn-delete-row';
    deleteBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
    deleteBtn.addEventListener('click', () => removeAttributeLocally(idx));
    
    actionTd.appendChild(deleteBtn);
    tr.appendChild(actionTd);

    elements.attributesListBody.appendChild(tr);
  });
}

function addAttributeLocally() {
  const name = elements.newAttrName.value.trim();
  const type = elements.newAttrType.value;
  const isBold = elements.newAttrBold.checked;
  const canBeEmpty = elements.newAttrEmpty.checked;
  const width = parseInt(elements.newAttrWidth.value) || 800;
  
  let enumValues = [];
  if (type === 'Enum') {
    const rawEnum = elements.newAttrEnum.value.trim();
    if (!rawEnum) {
      showToast(getTranslation('toast_col_enum_req'), 'error');
      return;
    }
    enumValues = rawEnum.split(',').map(s => s.trim()).filter(Boolean);
  }

  if (!name) {
    showToast(getTranslation('toast_col_req'), 'error');
    return;
  }

  if (appState.attributes.some(a => a.name.toLowerCase() === name.toLowerCase())) {
    showToast(getTranslation('toast_col_exists'), 'error');
    return;
  }

  appState.attributes.push({
    name,
    type,
    canBeEmpty,
    enumValues,
    columnWidth: width,
    isBold
  });

  // Clear inputs
  elements.newAttrName.value = '';
  elements.newAttrEnum.value = '';
  elements.newAttrBold.checked = false;
  elements.newAttrEmpty.checked = true;
  elements.newAttrWidth.value = '800';
  elements.newAttrEnumGroup.style.display = 'none';
  elements.newAttrType.value = 'String';

  renderAttributesSettings();
  showToast(getTranslation('toast_col_added'), 'info');
}

function removeAttributeLocally(index) {
  appState.attributes.splice(index, 1);
  renderAttributesSettings();
  showToast(getTranslation('toast_col_removed'), 'info');
}

async function resetAttributesToDefault() {
  if (confirm(getTranslation('confirm_reset_attr'))) {
    await loadData();
    showToast(getTranslation('toast_connected'), 'info');
  }
}

async function saveAttributesToServer() {
  try {
    const response = await fetch(`${appState.apiBase}/api/attributes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(appState.attributes)
    });

    if (!response.ok) throw new Error('API save error');
    
    appState.attributes = await response.json();
    renderUI();
    showToast(getTranslation('toast_attr_saved'), 'success');
  } catch (error) {
    showToast(`${getTranslation('toast_attr_error')}${error.message}`, 'error');
  }
}

async function handleFormSubmit(e) {
  e.preventDefault();

  const values = {};
  
  for (const attr of appState.attributes) {
    const input = document.getElementById(`field-${attr.name}`);
    if (!input) continue;

    let val = null;
    if (attr.type === 'Bool') {
      val = input.checked;
    } else {
      const rawVal = input.value;
      if (rawVal === '' && attr.canBeEmpty) {
        val = null;
      } else {
        if (attr.type === 'Int') {
          val = parseInt(rawVal);
          if (isNaN(val)) val = 0;
        } else if (attr.type === 'Double') {
          val = parseFloat(rawVal);
          if (isNaN(val)) val = 0.0;
        } else {
          val = rawVal;
        }
      }
    }
    values[attr.name] = val;
  }

  try {
    let response;
    if (appState.editingProductId) {
      response = await fetch(`${appState.apiBase}/api/products/${appState.editingProductId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values)
      });
    } else {
      response = await fetch(`${appState.apiBase}/api/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values)
      });
    }

    if (!response.ok) throw new Error('API failed');

    await reloadProducts();
    exitEditMode();
    showToast(appState.editingProductId ? getTranslation('toast_prod_updated') : getTranslation('toast_prod_added'), 'success');
  } catch (error) {
    showToast(`Error: ${error.message}`, 'error');
  }
}

async function reloadProducts() {
  const prodResponse = await fetch(`${appState.apiBase}/api/products`);
  if (prodResponse.ok) {
    appState.products = await prodResponse.json();
    renderInventoryTable();
  }
}

function enterEditMode(product) {
  appState.editingProductId = product.id;
  elements.formTitle.innerText = `${getTranslation('panel_edit_title')} #${product.id}`;
  elements.submitProductBtn.innerHTML = `<i class="fa-solid fa-check"></i> ${getTranslation('btn_save_changes')}`;
  elements.cancelEditBtn.classList.remove('hide');

  appState.attributes.forEach(attr => {
    const input = document.getElementById(`field-${attr.name}`);
    if (!input) return;

    const val = product.attributes[attr.name];
    if (attr.type === 'Bool') {
      input.checked = !!val;
    } else {
      input.value = val !== null && val !== undefined ? val : '';
    }
  });

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function exitEditMode() {
  appState.editingProductId = null;
  elements.formTitle.innerText = getTranslation('panel_add_title');
  elements.submitProductBtn.innerHTML = `<i class="fa-solid fa-plus"></i> ${getTranslation('btn_add_product')}`;
  elements.cancelEditBtn.classList.add('hide');
  elements.productForm.reset();
}

async function deleteProduct(id) {
  if (!confirm(`${getTranslation('confirm_delete_prod')}${id}?`)) return;

  try {
    const response = await fetch(`${appState.apiBase}/api/products/${id}`, {
      method: 'DELETE'
    });
    if (!response.ok) throw new Error('Delete API failed');
    
    showToast(`${getTranslation('toast_prod_deleted')}${id}`, 'info');
    reloadProducts();
  } catch (error) {
    showToast(`Error: ${error.message}`, 'error');
  }
}

async function clearAllProducts() {
  if (!confirm(getTranslation('confirm_clear_all'))) return;

  try {
    const response = await fetch(`${appState.apiBase}/api/products/clear`, {
      method: 'POST'
    });
    if (!response.ok) throw new Error('Clear API failed');

    showToast(getTranslation('toast_all_cleared'), 'info');
    reloadProducts();
  } catch (error) {
    showToast(`Error: ${error.message}`, 'error');
  }
}

// ----------------------------------------------------
// DOCUMENT PREVIEW MODAL LOGIC
// ----------------------------------------------------
function openPreviewModal(format) {
  if (appState.products.length === 0) {
    showToast(getTranslation('empty_state_title'), 'error');
    return;
  }
  
  appState.currentExportFormat = format;
  elements.documentPreviewContainer.innerHTML = '';
  
  if (format === 'html') {
    renderHtmlPreview();
  } else if (format === 'csv') {
    renderCsvPreview();
  } else if (format === 'docx') {
    renderDocxPreview();
  }

  elements.previewModal.classList.remove('hide');
}

function closePreviewModal() {
  elements.previewModal.classList.add('hide');
  appState.currentExportFormat = null;
}

function executeDownload() {
  if (!appState.currentExportFormat) return;
  const url = `${appState.apiBase}/api/export/${appState.currentExportFormat}`;
  showToast(getTranslation('toast_export_start'), 'success');
  window.open(url, '_blank');
  closePreviewModal();
}

// 1. DOCX representation (A4 sheet layout)
function renderDocxPreview() {
  const page = document.createElement('div');
  page.className = 'word-page';
  
  const title = document.createElement('h3');
  title.innerText = 'Inventory Report';
  page.appendChild(title);
  
  const table = document.createElement('table');
  
  const colGroup = document.createElement('colgroup');
  const totalWidth = appState.attributes.reduce((sum, a) => sum + a.columnWidth, 0);
  appState.attributes.forEach(attr => {
    const col = document.createElement('col');
    const pct = totalWidth > 0 ? (attr.columnWidth / totalWidth) * 100 : 100 / appState.attributes.length;
    col.style.width = `${pct}%`;
    colGroup.appendChild(col);
  });
  table.appendChild(colGroup);

  const thead = document.createElement('thead');
  const headerTr = document.createElement('tr');
  appState.attributes.forEach(attr => {
    const th = document.createElement('th');
    th.innerText = attr.name;
    headerTr.appendChild(th);
  });
  thead.appendChild(headerTr);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  appState.products.forEach(prod => {
    const tr = document.createElement('tr');
    appState.attributes.forEach(attr => {
      const td = document.createElement('td');
      const val = prod.attributes[attr.name];
      
      if (attr.type === 'Bool') {
        td.innerText = val === true ? getTranslation('opt_yes') : getTranslation('opt_no');
      } else if (attr.type === 'DateTime' && val) {
        td.innerText = new Date(val).toLocaleDateString();
      } else {
        td.innerText = val !== null && val !== undefined ? val : '';
      }

      if (isNumericType(attr.type)) {
        td.style.textAlign = 'right';
      }
      if (attr.isBold) {
        td.style.fontWeight = 'bold';
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  page.appendChild(table);

  elements.documentPreviewContainer.appendChild(page);
}

// 2. CSV representation
function renderCsvPreview() {
  const codeBlock = document.createElement('div');
  codeBlock.className = 'csv-code-view';

  const headers = appState.attributes.map(a => a.name).join(';');
  let csvText = headers + '\n';
  
  appState.products.forEach(prod => {
    const row = appState.attributes.map(attr => {
      let val = prod.attributes[attr.name];
      let str = val !== null && val !== undefined ? val.toString() : '';
      if (str.includes(';') || str.includes('"') || str.includes('\n')) {
        str = `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    }).join(';');
    csvText += row + '\n';
  });

  codeBlock.innerText = csvText;
  elements.documentPreviewContainer.appendChild(codeBlock);
}

// 3. HTML representation
function renderHtmlPreview() {
  const previewWrap = document.createElement('div');
  previewWrap.className = 'html-preview-view';
  
  const title = document.createElement('h2');
  title.innerText = 'Inventory Report';
  previewWrap.appendChild(title);
  
  const table = document.createElement('table');
  
  const thead = document.createElement('thead');
  const tr = document.createElement('tr');
  appState.attributes.forEach(attr => {
    const th = document.createElement('th');
    th.innerText = attr.name;
    tr.appendChild(th);
  });
  thead.appendChild(tr);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  appState.products.forEach(prod => {
    const tr = document.createElement('tr');
    appState.attributes.forEach(attr => {
      const td = document.createElement('td');
      const val = prod.attributes[attr.name];
      if (attr.type === 'Bool') {
        td.innerText = val === true ? getTranslation('opt_yes') : getTranslation('opt_no');
      } else {
        td.innerText = val !== null && val !== undefined ? val : '';
      }
      if (isNumericType(attr.type)) {
        td.style.textAlign = 'right';
      }
      if (attr.isBold) {
        td.style.fontWeight = 'bold';
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  previewWrap.appendChild(table);

  elements.documentPreviewContainer.appendChild(previewWrap);
}

// ----------------------------------------------------
// PROJECT JSON BACKUP (EXPORT / IMPORT)
// ----------------------------------------------------
function exportProjectAsJson() {
  if (appState.attributes.length === 0) {
    showToast(getTranslation('toast_col_req'), 'error');
    return;
  }
  
  const backupData = {
    attributes: appState.attributes,
    products: appState.products
  };
  
  const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `inventory_backup_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  
  URL.revokeObjectURL(url);
}

function importProjectFromJson(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (event) => {
    try {
      const data = JSON.parse(event.target.result);
      if (!data.attributes || !data.products) {
        throw new Error('Invalid project structure');
      }

      const response = await fetch(`${appState.apiBase}/api/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      if (!response.ok) {
        throw new Error('Server import failed');
      }

      appState.attributes = data.attributes;
      appState.products = data.products;
      exitEditMode();
      renderUI();
      showToast(getTranslation('toast_import_success'), 'success');
    } catch (err) {
      showToast(`${getTranslation('toast_import_error')} (${err.message})`, 'error');
      console.error(err);
    } finally {
      elements.importJsonFile.value = '';
    }
  };
  reader.readAsText(file);
}

// ----------------------------------------------------
// UTILITIES & NOTIFICATIONS
// ----------------------------------------------------
function isNumericType(type) {
  return type === 'Int' || type === 'Double';
}

function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  let iconClass = 'fa-check-circle';
  if (type === 'error') iconClass = 'fa-triangle-exclamation';
  if (type === 'info') iconClass = 'fa-info-circle';

  toast.innerHTML = `
    <i class="fa-solid ${iconClass} toast-icon"></i>
    <span class="toast-message">${message}</span>
  `;

  elements.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'toastIn 0.2s cubic-bezier(0.16, 1, 0.3, 1) reverse forwards';
    setTimeout(() => {
      toast.remove();
    }, 200);
  }, 4000);
}
