// Cookie Helpers for User Preferences
function setCookie(name, value, days = 365) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)};expires=${expires};path=/;SameSite=Lax`;
}

function getCookie(name) {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : null;
}

// Application State - Local First
let appState = {
  attributes: [],
  products: [],
  nextProductId: 1,
  editingProductId: null,
  editingAttributeIndex: null,
  currentLanguage: getCookie('inventory_lang') || 'en',
  translations: {},
  currentTheme: getCookie('inventory_theme') || 'light',
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
  newAttrItalic: document.getElementById('new-attr-italic'),
  newAttrUnderline: document.getElementById('new-attr-underline'),
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
  await loadLocalData();
});

// Setup Event Listeners
function setupEventListeners() {
  elements.attributesToggle.addEventListener('click', () => {
    elements.attributesPanel.classList.toggle('collapsed');
  });

  elements.newAttrType.addEventListener('change', (e) => {
    if (e.target.value === 'Enum') {
      elements.newAttrEnumGroup.style.display = 'flex';
    } else {
      elements.newAttrEnumGroup.style.display = 'none';
    }
  });

  elements.addAttributeBtn.addEventListener('click', addAttributeLocally);

  elements.saveAttributesBtn.addEventListener('click', saveAttributesLocally);
  elements.resetAttributesBtn.addEventListener('click', resetAttributesToDefault);

  elements.productForm.addEventListener('submit', handleFormSubmit);
  elements.cancelEditBtn.addEventListener('click', exitEditMode);

  elements.clearAllBtn.addEventListener('click', clearAllProducts);

  elements.exportDocxBtn.addEventListener('click', () => openPreviewModal('docx'));
  elements.exportCsvBtn.addEventListener('click', () => openPreviewModal('csv'));
  elements.exportHtmlBtn.addEventListener('click', () => openPreviewModal('html'));

  elements.exportJsonBtn.addEventListener('click', exportProjectAsJson);
  elements.importJsonTriggerBtn.addEventListener('click', () => elements.importJsonFile.click());
  elements.importJsonFile.addEventListener('change', importProjectFromJson);

  elements.langPlBtn.addEventListener('click', () => changeLanguage('pl'));
  elements.langEnBtn.addEventListener('click', () => changeLanguage('en'));

  elements.themeToggleBtn.addEventListener('click', toggleTheme);

  elements.closeModalBtn.addEventListener('click', closePreviewModal);
  elements.modalCloseBtn.addEventListener('click', closePreviewModal);
  elements.modalDownloadBtn.addEventListener('click', executeDownload);
}

// ----------------------------------------------------
// LOCAL-FIRST DATA STORAGE (localStorage)
// ----------------------------------------------------
async function loadLocalData() {
  try {
    const savedAttributes = localStorage.getItem('inventory_attributes');
    if (savedAttributes) {
      appState.attributes = JSON.parse(savedAttributes);
    } else {
      // Fetch default attributes template from server if localStorage is empty
      const res = await fetch(`${appState.apiBase}/api/attributes/default`);
      if (res.ok) {
        appState.attributes = await res.json();
        saveAttributesToLocalStorage();
      }
    }

    const savedProducts = localStorage.getItem('inventory_products');
    if (savedProducts) {
      appState.products = JSON.parse(savedProducts);
      // Calculate next ID
      if (appState.products.length > 0) {
        const maxId = Math.max(...appState.products.map(p => p.id || 0));
        appState.nextProductId = maxId + 1;
      }
    } else {
      appState.products = [];
    }

    renderUI();
  } catch (error) {
    console.error('Local data load error:', error);
  }
}

function saveAttributesToLocalStorage() {
  localStorage.setItem('inventory_attributes', JSON.stringify(appState.attributes));
}

function saveProductsToLocalStorage() {
  localStorage.setItem('inventory_products', JSON.stringify(appState.products));
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
    setCookie('inventory_lang', lang);
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
  setCookie('inventory_theme', theme);
}

// ----------------------------------------------------
// UI RENDERING
// ----------------------------------------------------
function renderUI() {
  renderDynamicForm();
  renderInventoryTable();
  renderAttributesSettings();
}

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
      (attr.enumValues || []).forEach(val => {
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
  
  const idTh = document.createElement('th');
  idTh.innerText = 'ID';
  idTh.style.width = '60px';
  headerTr.appendChild(idTh);

  appState.attributes.forEach(attr => {
    const th = document.createElement('th');
    th.innerText = attr.name;
    if (isNumericType(attr.type)) {
      th.className = 'text-align-right';
    }
    headerTr.appendChild(th);
  });

  const actionsTh = document.createElement('th');
  actionsTh.innerText = getTranslation('col_action');
  actionsTh.style.width = '100px';
  headerTr.appendChild(actionsTh);
  elements.inventoryThead.appendChild(headerTr);

  appState.products.forEach(prod => {
    const tr = document.createElement('tr');
    
    const idTd = document.createElement('td');
    idTd.innerText = prod.id;
    tr.appendChild(idTd);

    appState.attributes.forEach(attr => {
      const td = document.createElement('td');
      const val = prod.attributes ? prod.attributes[attr.name] : null;
      
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
      if (attr.isItalic) {
        td.classList.add('font-italic');
      }
      if (attr.isUnderline) {
        td.classList.add('font-underline');
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

function renderAttributesSettings() {
  elements.attributesListBody.innerHTML = '';

  appState.attributes.forEach((attr, idx) => {
    const tr = document.createElement('tr');
    if (appState.editingAttributeIndex === idx) {
      tr.style.background = 'rgba(var(--primary-rgb), 0.08)';
    }
    
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
    const styles = [];
    if (attr.isBold) styles.push('<strong>B</strong>');
    if (attr.isItalic) styles.push('<em>I</em>');
    if (attr.isUnderline) styles.push('<u>U</u>');
    boldTd.innerHTML = styles.length > 0 ? styles.join(' ') : '<span style="color: var(--text-muted);">-</span>';
    tr.appendChild(boldTd);

    const actionTd = document.createElement('td');
    actionTd.className = 'row-actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'btn-row-action btn-edit-row';
    editBtn.innerHTML = '<i class="fa-solid fa-pencil"></i>';
    editBtn.addEventListener('click', () => editAttributeLocally(idx));

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-row-action btn-delete-row';
    deleteBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
    deleteBtn.addEventListener('click', () => removeAttributeLocally(idx));
    
    actionTd.appendChild(editBtn);
    actionTd.appendChild(deleteBtn);
    tr.appendChild(actionTd);

    elements.attributesListBody.appendChild(tr);
  });
}

function addAttributeLocally() {
  const name = elements.newAttrName.value.trim();
  const type = elements.newAttrType.value;
  const isBold = elements.newAttrBold.checked;
  const isItalic = elements.newAttrItalic ? elements.newAttrItalic.checked : false;
  const isUnderline = elements.newAttrUnderline ? elements.newAttrUnderline.checked : false;
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

  const newAttr = { name, type, canBeEmpty, enumValues, columnWidth: width, isBold, isItalic, isUnderline };

  if (appState.editingAttributeIndex !== null) {
    // Edit mode: replace the attribute at the editing index
    const dupIdx = appState.attributes.findIndex((a, i) => i !== appState.editingAttributeIndex && a.name.toLowerCase() === name.toLowerCase());
    if (dupIdx !== -1) {
      showToast(getTranslation('toast_col_exists'), 'error');
      return;
    }
    appState.attributes[appState.editingAttributeIndex] = newAttr;
    appState.editingAttributeIndex = null;
    showToast(getTranslation('toast_col_updated'), 'success');
  } else {
    // Add mode: check for duplicates, then push
    if (appState.attributes.some(a => a.name.toLowerCase() === name.toLowerCase())) {
      showToast(getTranslation('toast_col_exists'), 'error');
      return;
    }
    appState.attributes.push(newAttr);
    showToast(getTranslation('toast_col_added'), 'info');
  }

  clearAttributeForm();
  saveAttributesToLocalStorage();
  renderUI();
}

function editAttributeLocally(index) {
  const attr = appState.attributes[index];
  if (!attr) return;

  appState.editingAttributeIndex = index;

  elements.newAttrName.value = attr.name;
  elements.newAttrType.value = attr.type;
  elements.newAttrEmpty.checked = attr.canBeEmpty;
  elements.newAttrBold.checked = !!attr.isBold;
  if (elements.newAttrItalic) elements.newAttrItalic.checked = !!attr.isItalic;
  if (elements.newAttrUnderline) elements.newAttrUnderline.checked = !!attr.isUnderline;
  elements.newAttrWidth.value = attr.columnWidth;

  if (attr.type === 'Enum') {
    elements.newAttrEnumGroup.style.display = 'flex';
    elements.newAttrEnum.value = (attr.enumValues || []).join(', ');
  } else {
    elements.newAttrEnumGroup.style.display = 'none';
    elements.newAttrEnum.value = '';
  }

  // Update button text to indicate edit mode
  elements.addAttributeBtn.innerHTML = `<i class="fa-solid fa-check"></i> ${getTranslation('btn_save_changes')}`;

  // Expand the settings panel if collapsed
  elements.attributesPanel.classList.remove('collapsed');

  renderAttributesSettings();
}

function cancelAttributeEdit() {
  appState.editingAttributeIndex = null;
  clearAttributeForm();
  renderAttributesSettings();
}

function clearAttributeForm() {
  elements.newAttrName.value = '';
  elements.newAttrEnum.value = '';
  elements.newAttrBold.checked = false;
  if (elements.newAttrItalic) elements.newAttrItalic.checked = false;
  if (elements.newAttrUnderline) elements.newAttrUnderline.checked = false;
  elements.newAttrEmpty.checked = true;
  elements.newAttrWidth.value = '800';
  elements.newAttrEnumGroup.style.display = 'none';
  elements.newAttrType.value = 'String';
  elements.addAttributeBtn.innerHTML = `<i class="fa-solid fa-plus-square"></i> ${getTranslation('btn_add_column')}`;
}

function removeAttributeLocally(index) {
  appState.attributes.splice(index, 1);
  saveAttributesToLocalStorage();
  renderUI();
  showToast(getTranslation('toast_col_removed'), 'info');
}

async function resetAttributesToDefault() {
  if (confirm(getTranslation('confirm_reset_attr'))) {
    const res = await fetch(`${appState.apiBase}/api/attributes/default`);
    if (res.ok) {
      appState.attributes = await res.json();
      saveAttributesToLocalStorage();
      renderUI();
      showToast(getTranslation('toast_attr_saved'), 'info');
    }
  }
}

function saveAttributesLocally() {
  saveAttributesToLocalStorage();
  renderUI();
  showToast(getTranslation('toast_attr_saved'), 'success');
}

function handleFormSubmit(e) {
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

  if (appState.editingProductId) {
    const product = appState.products.find(p => p.id === appState.editingProductId);
    if (product) {
      product.attributes = values;
    }
    showToast(getTranslation('toast_prod_updated'), 'success');
  } else {
    const newProduct = {
      id: appState.nextProductId++,
      attributes: values
    };
    appState.products.push(newProduct);
    showToast(getTranslation('toast_prod_added'), 'success');
  }

  saveProductsToLocalStorage();
  exitEditMode();
  renderInventoryTable();
}

function enterEditMode(product) {
  appState.editingProductId = product.id;
  elements.formTitle.innerText = `${getTranslation('panel_edit_title')} #${product.id}`;
  elements.submitProductBtn.innerHTML = `<i class="fa-solid fa-check"></i> ${getTranslation('btn_save_changes')}`;
  elements.cancelEditBtn.classList.remove('hide');

  appState.attributes.forEach(attr => {
    const input = document.getElementById(`field-${attr.name}`);
    if (!input) return;

    const val = product.attributes ? product.attributes[attr.name] : null;
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

function deleteProduct(id) {
  if (!confirm(`${getTranslation('confirm_delete_prod')}${id}?`)) return;

  appState.products = appState.products.filter(p => p.id !== id);
  saveProductsToLocalStorage();
  showToast(`${getTranslation('toast_prod_deleted')}${id}`, 'info');
  renderInventoryTable();
}

function clearAllProducts() {
  if (!confirm(getTranslation('confirm_clear_all'))) return;

  appState.products = [];
  appState.nextProductId = 1;
  saveProductsToLocalStorage();
  showToast(getTranslation('toast_all_cleared'), 'info');
  renderInventoryTable();
}

// ----------------------------------------------------
// DOCUMENT PREVIEW & STATELESS EXPORT
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

async function executeDownload() {
  if (!appState.currentExportFormat) return;

  const format = appState.currentExportFormat;
  showToast(getTranslation('toast_export_start'), 'info');

  try {
    const payload = {
      attributes: appState.attributes,
      products: appState.products
    };

    const response = await fetch(`${appState.apiBase}/api/export/${format}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) throw new Error('Export request failed');

    const blob = await response.blob();
    const downloadUrl = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `inventory_${new Date().toISOString().slice(0, 10)}.${format}`;
    a.click();
    
    URL.revokeObjectURL(downloadUrl);
    closePreviewModal();
  } catch (error) {
    showToast(`Export error: ${error.message}`, 'error');
    console.error(error);
  }
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
      const val = prod.attributes ? prod.attributes[attr.name] : null;
      
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
      if (attr.isItalic) {
        td.style.fontStyle = 'italic';
      }
      if (attr.isUnderline) {
        td.style.textDecoration = 'underline';
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
      let val = prod.attributes ? prod.attributes[attr.name] : null;
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
      const val = prod.attributes ? prod.attributes[attr.name] : null;
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
      if (attr.isItalic) {
        td.style.fontStyle = 'italic';
      }
      if (attr.isUnderline) {
        td.style.textDecoration = 'underline';
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
// PROJECT JSON BACKUP (LOCAL EXPORT / LOCAL IMPORT)
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
  reader.onload = (event) => {
    try {
      const data = JSON.parse(event.target.result);
      if (!data.attributes || !data.products) {
        throw new Error('Invalid project structure');
      }

      appState.attributes = data.attributes;
      appState.products = data.products;
      if (appState.products.length > 0) {
        const maxId = Math.max(...appState.products.map(p => p.id || 0));
        appState.nextProductId = maxId + 1;
      } else {
        appState.nextProductId = 1;
      }

      saveAttributesToLocalStorage();
      saveProductsToLocalStorage();
      
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
