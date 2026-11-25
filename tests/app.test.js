import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { randomUUID, webcrypto } from 'node:crypto';

const script = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

function session(storage, network, cryptoApi = { randomUUID }) {
  const elements = new Map();
  function element(id = '') {
    if (id && elements.has(id)) return elements.get(id);
    const item = {
      id, value: '', textContent: '', disabled: id === 'material', open: false, children: [], listeners: {},
      get valueAsNumber() { return this.value === '' ? NaN : Number(this.value); },
      addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
      async emit(type, event = {}) { for (const fn of this.listeners[type] || []) await fn(event); },
      setCustomValidity() {}, setAttribute() {}, add() {},
      append(child) { this.children.push(child); },
      replaceChildren(...children) { this.children = children; },
      showModal() { this.open = true; },
      close() { this.open = false; this.emit('close'); },
    };
    if (id) elements.set(id, item);
    return item;
  }
  const context = vm.createContext({
    document: { getElementById: element, createElement: () => element() },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    crypto: cryptoApi, Intl, Map, Set, Number, encodeURIComponent, Option: function () {}, fetch: network,
  });
  vm.runInContext(script, context);
  return { el: element };
}

test('network HTTP without randomUUID generates and restores a valid request ID', async () => {
  const storage = new Map();
  const network = async () => ({ ok: true, json: async () => [] });
  const cryptoApi = { getRandomValues: bytes => webcrypto.getRandomValues(bytes) };
  const first = session(storage, network, cryptoApi); await tick();
  const id = first.el('request-id').value;
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const second = session(storage, network, cryptoApi); await tick();
  assert.equal(second.el('request-id').value, id);
});

test('refresh restores request and inputs; failures retain them; success reads list after POST', async () => {
  const storage = new Map();
  let failSave = true;
  let rows = [];
  const calls = [];
  const response = (data, ok = true) => ({ ok, json: async () => data });
  const network = async (url, options) => {
    calls.push([url, options?.method || 'GET']);
    if (url === '/api/materials') return response([{ code: 'M001', name: 'Steel', density: 7.85 }]);
    if (url.startsWith('/api/customers')) return response([{ code: 'C001', name: 'Customer', contact: 'Contact' }]);
    if (url.startsWith('/api/items')) return response([{ code: 'I001', name: 'Item', specification: 'DN100', unit: 'EA' }]);
    if (url === '/api/orders' && options?.method === 'POST') {
      const payload = JSON.parse(options.body);
      assert.deepEqual(Object.keys(payload).sort(), ['customerCode', 'itemCode', 'materialCode', 'quantity', 'requestId', 'volume']);
      if (failSave) return response({ error: 'Save failed' }, false);
      const row = { ...payload, customerName: 'Customer', itemName: 'Item', materialName: 'Steel', density: 7.85, unitWeight: 9.8125, totalWeight: 196.25 };
      rows = [row];
      return response(row);
    }
    if (url === '/api/orders') return response(rows);
    throw new Error(`Unexpected URL: ${url}`);
  };
  const first = session(storage, network);
  await tick();
  for (const type of ['customer', 'item']) {
    await first.el(`choose-${type}`).emit('click'); await tick();
    const row = first.el(`${type}-search-results`).children[0];
    await row.children.at(-1).children[0].emit('click');
  }
  first.el('material').value = 'M001'; await first.el('material').emit('change');
  first.el('volume').value = '1250'; await first.el('volume').emit('input');
  first.el('quantity').value = '20'; await first.el('quantity').emit('input');
  const ids = ['request-id', 'customer-code', 'customer-name', 'customer-contact', 'item-code', 'item-name', 'item-specification', 'material', 'volume', 'quantity'];
  const snapshot = view => ids.map(id => view.el(id).value);
  const expected = snapshot(first);
  assert.equal(first.el('total-weight').textContent, '196.25');
  const refreshed = session(storage, network); await tick();
  assert.deepEqual(snapshot(refreshed), expected);
  assert.equal(refreshed.el('total-weight').textContent, '196.25');
  await refreshed.el('save-order').emit('click');
  assert.deepEqual(snapshot(refreshed), expected);
  assert.ok(refreshed.el('save-status').textContent.includes('Save failed'));
  const afterFailure = session(storage, network); await tick();
  assert.deepEqual(snapshot(afterFailure), expected);
  failSave = false;
  await afterFailure.el('save-order').emit('click');
  assert.deepEqual(calls.slice(-2), [['/api/orders', 'POST'], ['/api/orders', 'GET']]);
  assert.equal(afterFailure.el('orders-results').children.length, 1);
  assert.deepEqual(snapshot(afterFailure), expected);
  const afterSuccess = session(storage, network); await tick();
  assert.deepEqual(snapshot(afterSuccess), expected);
  assert.equal(afterSuccess.el('orders-results').children[0].children[0].textContent, expected[0]);
  afterSuccess.el('quantity').value = '21'; await afterSuccess.el('quantity').emit('input');
  assert.notEqual(afterSuccess.el('request-id').value, expected[0]);
});

test('delete confirmation uses request ID; cancel/close preserve data; failure keeps row; success reloads', async () => {
  const storage = new Map();
  let rows = [
    { requestId: 'first-id', customerCode: 'C1', customerName: 'Customer 1', itemCode: 'I1', itemName: 'Item 1' },
    { requestId: 'second-id', customerCode: 'C2', customerName: 'Customer 2', itemCode: 'I2', itemName: 'Item 2' },
  ];
  const calls = [];
  let fail = true;
  const response = (data, ok = true) => ({ ok, json: async () => data });
  const page = session(storage, async (url, options) => {
    const method = options?.method || 'GET';
    calls.push([url, method]);
    if (url === '/api/materials') return response([]);
    if (url === '/api/orders') return response(rows);
    if (method === 'DELETE') {
      assert.equal(url, '/api/orders/second-id');
      if (fail) return response({ error: 'Delete failed' }, false);
      rows = rows.filter(row => row.requestId !== 'second-id');
      return response({ deleted: true, requestId: 'second-id' });
    }
    throw new Error(`Unexpected request ${url}`);
  });
  await tick();
  const el = page.el;
  const open = async () => el('orders-results').children[0].children.at(-1).children[0].emit('click');
  await open();
  assert.equal(el('delete-order-id').textContent, 'second-id');
  assert.equal(el('delete-order-customer').textContent, 'C2 / Customer 2');
  assert.equal(el('delete-order-item').textContent, 'I2 / Item 2');
  for (const action of ['cancel-delete-order', 'close-delete-order']) {
    await el(action).emit('click');
    assert.equal(el('delete-order-dialog').open, false);
    assert.equal(calls.filter(([,method]) => method === 'DELETE').length, 0);
    assert.equal(rows.length, 2);
    await open();
  }
  await el('delete-order-dialog').emit('cancel', { preventDefault() {} });
  el('delete-order-dialog').close();
  assert.equal(calls.filter(([,method]) => method === 'DELETE').length, 0);
  await open();
  await el('confirm-delete-order').emit('click');
  assert.equal(el('orders-results').children.length, 2);
  assert.equal(el('delete-order-dialog').open, true);
  assert.ok(el('delete-order-error').textContent.includes('Delete failed'));
  const draftBefore = storage.get('estimate-order-draft-v1');
  fail = false;
  await el('confirm-delete-order').emit('click');
  assert.deepEqual(calls.slice(-2), [['/api/orders/second-id', 'DELETE'], ['/api/orders', 'GET']]);
  assert.equal(el('delete-order-dialog').open, false);
  assert.equal(el('orders-results').children.length, 1);
  assert.equal(el('orders-results').children[0].children[0].textContent, 'first-id');
  assert.equal(storage.get('estimate-order-draft-v1'), draftBefore);
});

test('email preview reads saved ID, requires recipient confirmation, guards double submits and retains inputs on failure', async () => {
  const storage = new Map();
  const calls = [];
  let fail = true;
  let release;
  const draft = { requestId: 'saved-id', defaultRecipient: 'customer@example.com', subject: 'Saved subject', body: 'Saved record body', version: 'snapshot', mode: 'preview' };
  const response = (data, ok = true) => ({ ok, json: async () => data });
  const page = session(storage, async (url, options) => {
    calls.push([url, options]);
    if (url === '/api/materials') return response([]);
    if (url === '/api/orders') return response([{ requestId: 'saved-id', customerCode: 'C1', customerName: 'Customer', itemCode: 'I1', itemName: 'Item' }]);
    if (url.endsWith('/email-preview')) return response(draft);
    if (url.endsWith('/email')) {
      assert.equal(url, '/api/orders/saved-id/email');
      assert.equal(options.method, 'POST');
      assert.deepEqual(JSON.parse(options.body), { mode: 'preview', recipient: 'one@example.com', confirmed: true, version: 'snapshot' });
      await new Promise(resolve => { release = resolve; });
      if (fail) return response({ error: 'Write failed' }, false);
      return response({ mode: 'preview', sent: false, downloadUrl: '/api/mail-previews/file', duplicate: true });
    }
    throw new Error(`Unexpected request ${url}`);
  });
  await tick();
  const el = page.el;
  el('volume').value = '1250'; el('quantity').value = '20';
  const before = storage.get('estimate-order-draft-v1');
  const emailButton = el('orders-results').children[0].children.at(-2).children[0];
  await emailButton.emit('click');
  assert.equal(el('email-order-id').textContent, 'saved-id');
  assert.equal(el('email-body').value, 'Saved record body');
  assert.equal(el('email-recipient').value, 'customer@example.com');
  const submit = () => el('email-form').emit('submit', { preventDefault() {} });
  await submit();
  assert.equal(calls.filter(([url]) => url.endsWith('/email')).length, 0);
  el('email-recipient').value = 'one@example.com'; await el('email-recipient').emit('input');
  draft.defaultRecipient = 'updated@example.com';
  await el('reload-email').emit('click');
  assert.equal(el('email-recipient').value, 'one@example.com');
  el('email-confirmed').checked = true; await el('email-confirmed').emit('change');
  const first = submit(); await tick();
  await submit();
  assert.equal(calls.filter(([url]) => url.endsWith('/email')).length, 1);
  release(); await first;
  assert.ok(el('email-status').textContent.includes('Write failed'));
  assert.equal(el('email-recipient').value, 'one@example.com');
  assert.equal(el('email-body').value, 'Saved record body');
  assert.equal(el('volume').value, '1250'); assert.equal(el('quantity').value, '20');
  assert.equal(storage.get('estimate-order-draft-v1'), before);
  assert.equal(el('orders-results').children.length, 1);
  fail = false;
  const retry = submit(); await tick(); release(); await retry;
  assert.equal(el('email-download').hidden, false);
  assert.equal(el('email-download').href, '/api/mail-previews/file');
  assert.equal(el('volume').value, '1250');
  el('email-recipient').value = 'two@example.com'; await el('email-recipient').emit('input');
  assert.equal(el('email-confirmed').checked, false);
  assert.equal(el('email-download').hidden, true);
});

test('actual send uses explicit SMTP button; no send before confirmation; failures preserve inputs', async () => {
  const storage = new Map();
  let calls = 0;
  let fail = true;
  const response = (data, ok = true) => ({ ok, json: async () => data });
  const page = session(storage, async (url, options) => {
    if (url === '/api/materials') return response([]);
    if (url === '/api/orders') return response([{ requestId: 'smtp-id' }]);
    if (url.endsWith('/email-preview')) return response({ requestId: 'smtp-id', mode: 'preview', subject: 'Saved subject', body: 'Saved body', version: 'v1', defaultRecipient: 'one@example.com', smtpAvailable: true, smtpHost: 'mail.ezgeo.com' });
    if (url.endsWith('/email')) {
      calls += 1;
      assert.deepEqual(JSON.parse(options.body), { mode: 'smtp', recipient: 'one@example.com', confirmed: true, sendConfirmed: true, version: 'v1' });
      return fail ? response({ error: 'SMTP failed' }, false) : response({ mode: 'smtp', sent: true, duplicate: false });
    }
    throw new Error(`Unexpected URL ${url}`);
  });
  await tick();
  const el = page.el;
  await el('orders-results').children[0].children.at(-2).children[0].emit('click');
  assert.equal(el('send-email').disabled, true);
  assert.ok(el('smtp-status').textContent.includes('mail.ezgeo.com'));
  const submit = () => el('email-form').emit('submit', { preventDefault() {}, submitter: el('send-email') });
  await submit(); assert.equal(calls, 0);
  el('email-confirmed').checked = true; await el('email-confirmed').emit('change');
  assert.equal(el('send-email').disabled, false);
  el('volume').value = '1250'; el('quantity').value = '20';
  const draft = storage.get('estimate-order-draft-v1');
  await submit(); assert.equal(calls, 1);
  assert.ok(el('email-status').textContent.includes('SMTP failed'));
  assert.equal(el('email-recipient').value, 'one@example.com');
  assert.equal(el('email-body').value, 'Saved body');
  fail = false; await submit(); assert.equal(calls, 2);
  assert.ok(el('email-status').textContent.includes('SMTP'));
  assert.equal(el('volume').value, '1250'); assert.equal(el('quantity').value, '20');
  assert.equal(storage.get('estimate-order-draft-v1'), draft);
});
