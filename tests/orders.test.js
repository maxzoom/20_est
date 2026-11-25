import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, copyFile, readFile, rm, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { createOrderStore } from '../orders.js';

test('latest source values, unrounded weights, retry safety, concurrent writes and durable rows', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'estimate-orders-'));
  const file = path.join(dir, 'orders.xlsx');
  await copyFile(new URL('../excel/주문내역.xlsx', import.meta.url), file);
  let density = 7.85;
  const options = {
    file,
    customers: async () => [{ code: 'C1', name: '최신 거래처', contact: '담당자' }],
    items: async () => [{ code: 'I1', name: '최신 품목', specification: 'DN100' }],
    materials: async () => [{ code: 'M1', name: '최신 재질', density }],
  };
  const store = createOrderStore(options);
  const payload = { requestId: 'test-1', customerCode: 'C1', itemCode: 'I1', materialCode: 'M1', volume: 1250, quantity: 20 };
  const original = await readFile(file);
  try {
    for (const input of [null, { ...payload, volume: 0 }, { ...payload, volume: '1250' },
      { ...payload, quantity: 1.5 }, { ...payload, customerCode: 'missing' },
      { ...payload, itemCode: 'missing' }, { ...payload, materialCode: 'missing' }]) {
      await assert.rejects(store.save(input), { statusCode: 400 });
    }
    assert.deepEqual(await readFile(file), original);
    const first = await store.save({ ...payload, density: 99, unitWeight: 99, customerName: '偽' });
    assert.equal(first.created, true);
    assert.equal(first.order.customerName, '최신 거래처');
    assert.equal(first.order.itemName, '최신 품목');
    assert.equal(first.order.materialName, '최신 재질');
    assert.equal(first.order.density, 7.85);
    assert.equal(first.order.unitWeight, 9.8125);
    assert.equal(first.order.totalWeight, 196.25);
    density = 8;
    const retry = await store.save(payload);
    assert.equal(retry.created, false);
    assert.deepEqual(retry.order, first.order);
    await assert.rejects(store.save({ ...payload, quantity: 21 }), { statusCode: 409 });
    const [a, b] = await Promise.all([
      store.save({ ...payload, requestId: 'test-2', volume: 1.23456789, quantity: 1000000 }),
      store.save({ ...payload, requestId: 'test-3' }),
    ]);
    assert.equal(a.order.density, 8);
    assert.equal(a.order.totalWeight, (1.23456789 * 8 / 1000) * 1000000);
    assert.equal(b.order.totalWeight, 200);
    const rows = await createOrderStore(options).list();
    assert.equal(rows.filter(row => row.requestId.startsWith('test-')).length, 3);
    assert.deepEqual(rows.find(row => row.requestId === 'test-1'), first.order);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(file);
    assert.ok(workbook.getWorksheet('사용안내'));
    const orderSheet = workbook.getWorksheet('주문');
    assert.equal(typeof orderSheet.getRow(orderSheet.rowCount).getCell(13).value, 'number');
    const saved = await readFile(file);
    const lock = await open(`${file}.lock`, 'wx');
    try {
      await assert.rejects(store.save({ ...payload, requestId: 'locked' }), { statusCode: 503 });
      await assert.rejects(store.remove('test-1'), { statusCode: 503 });
    }
    finally { await lock.close(); await rm(`${file}.lock`); }
    assert.deepEqual(await readFile(file), saved);
    await assert.rejects(store.remove('missing-id'), { statusCode: 404 });
    await assert.rejects(store.remove('../bad'), { statusCode: 400 });
    assert.deepEqual(await readFile(file), saved);
    assert.equal((await store.remove('test-1')).requestId, 'test-1');
    // test-3 has shifted to a different physical Excel row after the first deletion.
    assert.equal((await store.remove('test-3')).requestId, 'test-3');
    const afterDelete = await createOrderStore(options).list();
    assert.deepEqual(afterDelete.filter(row => row.requestId.startsWith('test-')), [a.order]);
    assert.deepEqual(afterDelete.filter(row => !row.requestId.startsWith('test-')),
      rows.filter(row => !row.requestId.startsWith('test-')));
    await assert.rejects(store.remove('test-3'), { statusCode: 404 });
    await workbook.xlsx.readFile(file);
    assert.ok(workbook.getWorksheet('사용안내'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
