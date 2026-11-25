const customerDialog = document.getElementById('customer-dialog');
const customerQuery = document.getElementById('customer-query');
const customerSearchStatus = document.getElementById('customer-search-status');
const customerResults = document.getElementById('customer-search-results');
let customerSearchVersion = 0;

async function searchCustomers() {
  const version = ++customerSearchVersion;
  customerResults.replaceChildren();
  customerSearchStatus.textContent = '거래처를 검색하는 중입니다.';
  try {
    const response = await fetch(`/api/customers?q=${encodeURIComponent(customerQuery.value.trim())}`);
    const customers = await response.json();
    if (version !== customerSearchVersion || !customerDialog.open) return;
    if (!response.ok) throw new Error('거래처 조회 실패');
    if (!Array.isArray(customers) || customers.some(customer => !customer ||
      typeof customer.code !== 'string' || !customer.code.trim() ||
      typeof customer.name !== 'string' || !customer.name.trim() ||
      typeof customer.contact !== 'string')) throw new Error('거래처 형식 오류');
    for (const customer of customers) {
      const row = document.createElement('tr');
      for (const value of [customer.code, customer.name, customer.contact]) {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      }
      const actionCell = document.createElement('td');
      const choose = document.createElement('button');
      choose.type = 'button';
      choose.textContent = '선택';
      choose.setAttribute('aria-label', `${customer.code} ${customer.name} 선택`);
      choose.addEventListener('click', () => {
        if (version !== customerSearchVersion || !customerDialog.open) return;
        document.getElementById('customer-code').value = customer.code;
        document.getElementById('customer-name').value = customer.name;
        document.getElementById('customer-contact').value = customer.contact;
        persistDraft();
        customerDialog.close();
      });
      actionCell.append(choose);
      row.append(actionCell);
      customerResults.append(row);
    }
    customerSearchStatus.textContent = customers.length ? `${customers.length}건을 찾았습니다. 선택할 행을 확인하세요.` : '검색 결과가 없습니다.';
  } catch (error) {
    if (version !== customerSearchVersion || !customerDialog.open) return;
    customerResults.replaceChildren();
    customerSearchStatus.textContent = '거래처를 불러오지 못했습니다. 검색 버튼을 눌러 다시 시도해 주세요.';
  }
}

document.getElementById('choose-customer').addEventListener('click', () => {
  customerQuery.value = '';
  customerDialog.showModal();
  searchCustomers();
});
document.getElementById('customer-search-form').addEventListener('submit', event => {
  event.preventDefault();
  searchCustomers();
});
for (const id of ['close-customers', 'cancel-customers']) {
  document.getElementById(id).addEventListener('click', () => customerDialog.close());
}
customerDialog.addEventListener('close', () => { customerSearchVersion += 1; });
customerDialog.addEventListener('cancel', () => { customerSearchVersion += 1; });

const itemDialog = document.getElementById('item-dialog');
const itemQuery = document.getElementById('item-query');
const itemSearchStatus = document.getElementById('item-search-status');
const itemResults = document.getElementById('item-search-results');
let itemSearchVersion = 0;

async function searchItems() {
  const version = ++itemSearchVersion;
  itemResults.replaceChildren();
  itemSearchStatus.textContent = '품목을 검색하는 중입니다.';
  try {
    const response = await fetch(`/api/items?q=${encodeURIComponent(itemQuery.value.trim())}`);
    const items = await response.json();
    if (version !== itemSearchVersion || !itemDialog.open) return;
    if (!response.ok) throw new Error('품목 조회 실패');
    if (!Array.isArray(items) || items.some(item => !item ||
      typeof item.code !== 'string' || !item.code.trim() ||
      typeof item.name !== 'string' || !item.name.trim() ||
      typeof item.specification !== 'string')) throw new Error('품목 형식 오류');
    for (const item of items) {
      const row = document.createElement('tr');
      for (const value of [item.code, item.name, item.specification, item.unit ?? '']) {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      }
      const actionCell = document.createElement('td');
      const choose = document.createElement('button');
      choose.type = 'button';
      choose.textContent = '선택';
      choose.setAttribute('aria-label', `${item.code} ${item.name} 선택`);
      choose.addEventListener('click', () => {
        if (version !== itemSearchVersion || !itemDialog.open) return;
        document.getElementById('item-code').value = item.code;
        document.getElementById('item-name').value = item.name;
        document.getElementById('item-specification').value = item.specification;
        persistDraft();
        itemDialog.close();
      });
      actionCell.append(choose);
      row.append(actionCell);
      itemResults.append(row);
    }
    itemSearchStatus.textContent = items.length ? `${items.length}건을 찾았습니다. 선택할 행을 확인하세요.` : '검색 결과가 없습니다.';
  } catch (error) {
    if (version !== itemSearchVersion || !itemDialog.open) return;
    itemResults.replaceChildren();
    itemSearchStatus.textContent = '품목을 불러오지 못했습니다. 검색 버튼을 눌러 다시 시도해 주세요.';
  }
}

document.getElementById('choose-item').addEventListener('click', () => {
  itemQuery.value = '';
  itemDialog.showModal();
  searchItems();
});
document.getElementById('item-search-form').addEventListener('submit', event => {
  event.preventDefault();
  searchItems();
});
for (const id of ['close-items', 'cancel-items']) {
  document.getElementById(id).addEventListener('click', () => itemDialog.close());
}
itemDialog.addEventListener('close', () => { itemSearchVersion += 1; });
itemDialog.addEventListener('cancel', () => { itemSearchVersion += 1; });

const button = document.getElementById('refresh');
const status = document.getElementById('status');
const select = document.getElementById('material');
const density = document.getElementById('density');
const volume = document.getElementById('volume');
const quantity = document.getElementById('quantity');
const unitWeight = document.getElementById('unit-weight');
const totalWeight = document.getElementById('total-weight');
const calculationStatus = document.getElementById('calculation-status');
const weightFormat = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 6 });
let materialsByCode = new Map();

function validateInput(input, valid, message) {
  const error = valid ? '' : message;
  input.setCustomValidity(error);
  input.setAttribute('aria-invalid', String(!valid));
  document.getElementById(`${input.id}-error`).textContent = error;
  return valid;
}

function updateWeights() {
  unitWeight.textContent = '—';
  totalWeight.textContent = '—';
  const volumeValue = volume.valueAsNumber;
  const quantityValue = quantity.valueAsNumber;
  const volumeValid = validateInput(volume, Number.isFinite(volumeValue) && volumeValue > 0,
    '부피는 0보다 큰 숫자로 입력해줘.');
  const quantityValid = validateInput(quantity, Number.isSafeInteger(quantityValue) && quantityValue > 0,
    '수량은 계산 가능한 범위의 양의 정수로 입력해 주세요.');
  const material = materialsByCode.get(select.value);
  if (!material || !volumeValid || !quantityValid) {
    calculationStatus.textContent = '재질을 선택하고 올바른 부피와 수량을 입력해 주세요.';
    return;
  }
  const unit = volumeValue * material.density / 1000;
  const total = unit * quantityValue;
  if (!Number.isFinite(unit) || !Number.isFinite(total) || unit <= 0 || total <= 0) {
    calculationStatus.textContent = '계산 가능한 숫자 범위를 벗어났습니다. 입력값을 조정해 주세요.';
    return;
  }
  unitWeight.textContent = weightFormat.format(unit);
  totalWeight.textContent = weightFormat.format(total);
  calculationStatus.textContent = '입력값에 따라 자동으로 계산되었습니다.';
}

function resetSelection(message) {
  materialsByCode.clear();
  select.replaceChildren(new Option(message, ''));
  select.disabled = true;
  density.value = '';
  updateWeights();
}

select.addEventListener('change', () => {
  const material = materialsByCode.get(select.value);
  density.value = material ? String(material.density) : '';
  updateWeights();
});
for (const input of [volume, quantity]) {
  input.addEventListener('input', updateWeights);
  input.addEventListener('change', updateWeights);
}

async function loadMaterials() {
  const selectedCode = select.value || restoredMaterialCode;
  button.disabled = true;
  resetSelection('재질 목록을 불러오는 중입니다.');
  status.textContent = '재질 목록을 불러오는 중입니다.';
  try {
    const response = await fetch('/api/materials');
    const materials = await response.json();
    if (!response.ok) throw new Error(materials.error || '재질 조회에 실패했습니다.');
    if (!Array.isArray(materials) || materials.some(material =>
      !material || typeof material.code !== 'string' || !material.code.trim() ||
      typeof material.name !== 'string' || !material.name.trim() ||
      typeof material.density !== 'number' || !Number.isFinite(material.density) || material.density <= 0
    ) || new Set(materials.map(material => material.code)).size !== materials.length) {
      throw new Error('재질 목록의 형식이 올바르지 않습니다.');
    }
    if (materials.length === 0) {
      resetSelection('선택 가능한 재질 없음');
      status.textContent = '사용 가능한 재질이 없습니다. 등록된 재질의 사용여부를 확인해 주세요.';
      return;
    }
    select.replaceChildren(new Option('재질을 선택해 주세요.', ''));
    for (const material of materials) {
      materialsByCode.set(material.code, material);
      select.add(new Option(material.name, material.code));
    }
    select.disabled = false;
    if (materialsByCode.has(selectedCode)) select.value = selectedCode;
    else select.value = '';
    density.value = materialsByCode.has(select.value) ? String(materialsByCode.get(select.value).density) : '';
    updateWeights();
    status.textContent = `사용 가능한 재질 ${materials.length}개`;
  } catch (error) {
    resetSelection('재질 조회 실패');
    status.textContent = '재질 목록을 불러오지 못했습니다. 서버 연결을 확인하고 새로고침으로 다시 시도해 주세요.';
  } finally {
    button.disabled = false;
  }
}
button.addEventListener('click', loadMaterials);

const draftKey = 'estimate-order-draft-v1';
const draftFields = ['customer-code', 'customer-name', 'customer-contact', 'item-code', 'item-name', 'item-specification', 'volume', 'quantity'];
const requestId = document.getElementById('request-id');
const saveButton = document.getElementById('save-order');
const saveStatus = document.getElementById('save-status');
const draftStatus = document.getElementById('draft-status');
let restoredMaterialCode = '';
let lastSignature = '';
let saving = false;

function currentPayload() {
  return {
    requestId: requestId.value,
    customerCode: document.getElementById('customer-code').value,
    itemCode: document.getElementById('item-code').value,
    materialCode: select.value || (select.disabled ? restoredMaterialCode : ''),
    volume: volume.valueAsNumber,
    quantity: quantity.valueAsNumber,
  };
}

function createRequestId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // Plain HTTP on a network IP does not expose randomUUID in some browsers.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function persistDraft() {
  const payload = currentPayload();
  const signature = JSON.stringify([payload.customerCode, payload.itemCode, payload.materialCode, volume.value, quantity.value]);
  if (!requestId.value || (lastSignature && lastSignature !== signature)) {
    requestId.value = createRequestId();
    if (lastSignature) saveStatus.textContent = '변경된 입력값은 아직 저장하지 않았습니다.';
  }
  lastSignature = signature;
  restoredMaterialCode = payload.materialCode;
  try {
    localStorage.setItem(draftKey, JSON.stringify({
      requestId: requestId.value, materialCode: payload.materialCode,
      values: Object.fromEntries(draftFields.map(id => [id, document.getElementById(id).value])),
    }));
    draftStatus.textContent = '요청ID와 입력값을 이 브라우저에 보관했습니다.';
    return true;
  } catch {
    draftStatus.textContent = '입력값을 브라우저에 보관하지 못했습니다.';
    return false;
  }
}

function restoreDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(draftKey) || 'null');
    if (draft && typeof draft.requestId === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(draft.requestId)) {
      requestId.value = draft.requestId;
      restoredMaterialCode = typeof draft.materialCode === 'string' ? draft.materialCode : '';
      for (const id of draftFields) {
        if (typeof draft.values?.[id] === 'string') document.getElementById(id).value = draft.values[id];
      }
    }
  } catch {
    draftStatus.textContent = '보관된 입력값을 복원하지 못했습니다.';
  }
  persistDraft();
}

for (const input of [select, volume, quantity]) {
  input.addEventListener('change', persistDraft);
  if (input !== select) input.addEventListener('input', persistDraft);
}

let ordersVersion = 0;
async function loadOrders() {
  const version = ++ordersVersion;
  const status = document.getElementById('orders-status');
  status.textContent = '저장된 주문을 불러오는 중입니다.';
  try {
    const response = await fetch('/api/orders');
    const orders = await response.json();
    if (!response.ok || !Array.isArray(orders)) throw new Error('목록 조회 실패');
    if (version !== ordersVersion) return false;
    const results = document.getElementById('orders-results');
    results.replaceChildren();
    for (const order of orders.slice().reverse()) {
      const row = document.createElement('tr');
      const values = [order.requestId, `${order.customerCode} / ${order.customerName}`,
        `${order.itemCode} / ${order.itemName}`, `${order.materialCode} / ${order.materialName}`,
        order.density, order.volume, order.quantity, order.unitWeight, order.totalWeight];
      for (const value of values) {
        const cell = document.createElement('td');
        cell.textContent = typeof value === 'number' ? weightFormat.format(value) : value;
        row.append(cell);
      }
      const emailCell = document.createElement('td');
      const email = document.createElement('button');
      email.type = 'button';
      email.textContent = '메일 미리보기';
      email.setAttribute('data-request-id', order.requestId);
      email.setAttribute('aria-label', `${order.requestId} 메일 미리보기`);
      email.setAttribute('aria-haspopup', 'dialog');
      email.setAttribute('aria-controls', 'email-dialog');
      email.addEventListener('click', () => openEmailPreview(order.requestId));
      emailCell.append(email);
      row.append(emailCell);
      const actionCell = document.createElement('td');
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'danger';
      remove.textContent = '삭제';
      remove.setAttribute('data-request-id', order.requestId);
      remove.setAttribute('aria-label', `${order.requestId} 주문 삭제`);
      remove.setAttribute('aria-haspopup', 'dialog');
      remove.setAttribute('aria-controls', 'delete-order-dialog');
      remove.addEventListener('click', () => openDeleteOrder(order));
      actionCell.append(remove);
      row.append(actionCell);
      results.append(row);
    }
    status.textContent = `저장된 주문 ${orders.length}건`;
    return true;
  } catch {
    if (version === ordersVersion) status.textContent = '주문 목록을 읽지 못했습니다. 목록 새로고침으로 다시 시도해 주세요.';
    return false;
  }
}

saveButton.addEventListener('click', async () => {
  if (saving) return;
  updateWeights();
  const payload = currentPayload();
  if (!payload.customerCode || !payload.itemCode || !materialsByCode.has(payload.materialCode) ||
    !Number.isFinite(payload.volume) || payload.volume <= 0 || !Number.isSafeInteger(payload.quantity) || payload.quantity <= 0) {
    saveStatus.textContent = '거래처, 품목, 재질을 선택하고 올바른 부피와 수량을 입력해 주세요.';
    return;
  }
  if (!persistDraft()) {
    saveStatus.textContent = '요청ID와 입력을 보관하지 못했습니다. 브라우저 저장소 설정을 확인해 주세요.';
    return;
  }
  payload.requestId = requestId.value;
  saving = true;
  saveButton.disabled = true;
  saveStatus.textContent = '서버에서 검사하고 저장하는 중입니다.';
  try {
    const response = await fetch('/api/orders', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const order = await response.json();
    if (!response.ok) throw new Error(order.error || '주문 저장에 실패했습니다.');
    if (requestId.value === payload.requestId) {
      const material = materialsByCode.get(payload.materialCode);
      materialsByCode.set(payload.materialCode, { ...material, density: order.density });
      density.value = String(order.density);
      unitWeight.textContent = weightFormat.format(order.unitWeight);
      totalWeight.textContent = weightFormat.format(order.totalWeight);
      calculationStatus.textContent = '서버에서 최신 밀도로 계산한 저장 결과입니다.';
    }
    saveStatus.textContent = `저장 완료: ${order.requestId}`;
    if (!await loadOrders()) saveStatus.textContent = `저장 완료: ${order.requestId}. 목록을 다시 읽지 못했습니다. 목록 새로고침을 눌러 주세요.`;
  } catch (error) {
    saveStatus.textContent = `${error.message} 입력과 요청ID는 유지됩니다. 같은 요청ID로 다시 시도할 수 있습니다.`;
  } finally {
    saving = false;
    saveButton.disabled = false;
  }
});

const deleteDialog = document.getElementById('delete-order-dialog');
const confirmDelete = document.getElementById('confirm-delete-order');
const deleteError = document.getElementById('delete-order-error');
const deleteStatus = document.getElementById('delete-status');
let pendingDelete = null;
let deleting = false;

function openDeleteOrder(order) {
  if (deleting) return;
  pendingDelete = { requestId: order.requestId };
  document.getElementById('delete-order-id').textContent = order.requestId;
  document.getElementById('delete-order-customer').textContent = `${order.customerCode} / ${order.customerName}`;
  document.getElementById('delete-order-item').textContent = `${order.itemCode} / ${order.itemName}`;
  deleteError.textContent = '';
  deleteDialog.showModal();
}

for (const id of ['close-delete-order', 'cancel-delete-order']) {
  document.getElementById(id).addEventListener('click', () => {
    if (!deleting) deleteDialog.close();
  });
}
deleteDialog.addEventListener('cancel', event => {
  if (deleting) event.preventDefault();
});
deleteDialog.addEventListener('close', () => { pendingDelete = null; });

confirmDelete.addEventListener('click', async () => {
  if (!pendingDelete || deleting || !deleteDialog.open) return;
  const id = pendingDelete.requestId;
  deleting = true;
  confirmDelete.disabled = true;
  deleteError.textContent = '';
  for (const buttonId of ['close-delete-order', 'cancel-delete-order']) document.getElementById(buttonId).disabled = true;
  try {
    const response = await fetch(`/api/orders/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '주문 삭제에 실패했습니다.');
    deleteDialog.close();
    deleteStatus.textContent = `삭제 완료: ${id}`;
    if (!await loadOrders()) deleteStatus.textContent = `삭제 완료: ${id}. 목록을 다시 읽지 못했습니다. 목록 새로고침을 눌러 주세요.`;
  } catch (error) {
    deleteError.textContent = `${error.message} 목록은 그대로 유지됩니다.`;
  } finally {
    deleting = false;
    confirmDelete.disabled = false;
    for (const buttonId of ['close-delete-order', 'cancel-delete-order']) document.getElementById(buttonId).disabled = false;
  }
});

const emailDialog = document.getElementById('email-dialog');
const emailRecipient = document.getElementById('email-recipient');
const emailConfirmed = document.getElementById('email-confirmed');
const emailStatus = document.getElementById('email-status');
const emailDownload = document.getElementById('email-download');
const createEmail = document.getElementById('create-email');
const sendEmail = document.getElementById('send-email');
let smtpSendAvailable = false;
let emailOrderId = '';
let emailVersion = '';
let emailLoadVersion = 0;
let emailBusy = false;
let emailRecipientEdited = false;

function updateEmailConfirmation() {
  createEmail.disabled = emailBusy || !emailVersion || !emailConfirmed.checked || !emailRecipient.value.trim();
  sendEmail.disabled = createEmail.disabled || !smtpSendAvailable;
}

async function readEmailPreview() {
  const version = ++emailLoadVersion;
  emailVersion = '';
  smtpSendAvailable = false;
  emailConfirmed.checked = false;
  emailDownload.hidden = true;
  document.getElementById('email-subject').value = '';
  document.getElementById('email-body').value = '';
  emailStatus.textContent = '저장된 주문 기록으로 본문을 작성하는 중입니다.';
  updateEmailConfirmation();
  try {
    const response = await fetch(`/api/orders/${encodeURIComponent(emailOrderId)}/email-preview`);
    const preview = await response.json();
    if (version !== emailLoadVersion || !emailDialog.open) return;
    if (!response.ok) throw new Error(preview.error || '메일 본문을 읽지 못했습니다.');
    if (preview.requestId !== emailOrderId || preview.mode !== 'preview' || typeof preview.version !== 'string' ||
      typeof preview.subject !== 'string' || typeof preview.body !== 'string') throw new Error('메일 미리보기 응답이 올바르지 않습니다.');
    emailVersion = preview.version;
    smtpSendAvailable = preview.smtpAvailable === true;
    document.getElementById('smtp-status').textContent = smtpSendAvailable ? `실제 발송 서버: ${preview.smtpHost}` : 'SMTP 설정이 필요합니다. 서버의 .env를 확인해 주세요.';
    if (!emailRecipientEdited) emailRecipient.value = typeof preview.defaultRecipient === 'string' ? preview.defaultRecipient : '';
    document.getElementById('email-subject').value = preview.subject;
    document.getElementById('email-body').value = preview.body;
    emailStatus.textContent = '수신자 1명과 본문을 확인한 뒤 미리보기 생성 또는 실제 메일 발송을 선택해 주세요.';
    updateEmailConfirmation();
  } catch (error) {
    if (version === emailLoadVersion && emailDialog.open) emailStatus.textContent = `${error.message} 주문과 입력은 유지됩니다.`;
  }
}

function openEmailPreview(id) {
  if (emailBusy) return;
  if (emailOrderId !== id) {
    emailRecipient.value = '';
    emailRecipientEdited = false;
  }
  emailOrderId = id;
  document.getElementById('email-order-id').textContent = id;
  emailDialog.showModal();
  return readEmailPreview();
}

emailRecipient.addEventListener('input', () => {
  emailRecipientEdited = true;
  emailConfirmed.checked = false;
  emailDownload.hidden = true;
  updateEmailConfirmation();
});
emailConfirmed.addEventListener('change', updateEmailConfirmation);
document.getElementById('reload-email').addEventListener('click', () => {
  if (!emailBusy) return readEmailPreview();
});
for (const id of ['close-email', 'cancel-email']) {
  document.getElementById(id).addEventListener('click', () => { if (!emailBusy) emailDialog.close(); });
}
emailDialog.addEventListener('cancel', event => { if (emailBusy) event.preventDefault(); });
emailDialog.addEventListener('close', () => { emailLoadVersion += 1; emailVersion = ''; });

document.getElementById('email-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (emailBusy || !emailVersion || !emailDialog.open) return;
  const mode = event.submitter === sendEmail ? 'smtp' : 'preview';
  if (mode === 'smtp' && !smtpSendAvailable) return;
  const recipient = emailRecipient.value.trim();
  if (!emailConfirmed.checked || !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(recipient)) {
    emailStatus.textContent = '올바른 수신자 이메일 1명과 본문을 확인한 뒤 체크해 주세요.';
    return;
  }
  emailBusy = true;
  updateEmailConfirmation();
  const controls = ['email-recipient', 'email-confirmed', 'close-email', 'cancel-email', 'reload-email'];
  for (const id of controls) document.getElementById(id).disabled = true;
  emailStatus.textContent = mode === 'smtp' ? 'SMTP 서버로 실제 메일을 발송하는 중입니다.' : '.eml 미리보기를 생성하는 중입니다. 실제 메일은 발송하지 않습니다.';
  try {
    const response = await fetch(`/api/orders/${encodeURIComponent(emailOrderId)}/email`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, recipient, confirmed: true, version: emailVersion, ...(mode === 'smtp' ? { sendConfirmed: true } : {}) }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '메일 처리에 실패했습니다.');
    if (mode === 'smtp') {
      if (result.mode !== 'smtp' || result.sent !== true) throw new Error('발송 결과 응답이 올바르지 않습니다.');
      emailStatus.textContent = result.duplicate ? '이미 SMTP 서버가 접수한 메일입니다. 중복 발송하지 않았습니다.' : `SMTP 서버가 ${recipient} 수신 메일을 접수했습니다.`;
    } else {
      if (result.mode !== 'preview' || result.sent !== false || typeof result.downloadUrl !== 'string') throw new Error('메일 처리 응답이 올바르지 않습니다.');
      emailDownload.href = result.downloadUrl;
      emailDownload.hidden = false;
      emailStatus.textContent = result.duplicate ? '이미 생성한 .eml을 사용합니다. 중복 생성하지 않았으며 실제 발송이 아닙니다.' : '.eml 미리보기가 생성되었습니다. 실제 메일은 발송하지 않았습니다.';
    }
  } catch (error) {
    emailStatus.textContent = `${error.message} 주문과 입력은 유지됩니다. 다시 시도해 주세요.`;
  } finally {
    emailBusy = false;
    for (const id of controls) document.getElementById(id).disabled = false;
    updateEmailConfirmation();
  }
});

document.getElementById('reload-orders').addEventListener('click', loadOrders);
restoreDraft();
loadMaterials();
loadOrders();
