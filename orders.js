import ExcelJS from 'exceljs';
import { open, rename, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { readCustomers } from './customers.js';
import { readItems } from './items.js';
import { readMaterials } from './materials.js';

const fields = {
  requestId: '요청ID', createdAt: '접수일시', customerCode: '거래처코드',
  customerName: '거래처명', contact: '담당자', itemCode: '품목코드', itemName: '품목명',
  specification: '규격', materialCode: '재질코드', materialName: '재질명',
  density: '적용밀도_g_cm3', volume: '개당부피_cm3', quantity: '수량',
  unitWeight: '개당중량_kg', totalWeight: '총중량_kg',
};
const numericFields = new Set(['density', 'volume', 'quantity', 'unitWeight', 'totalWeight']);
const inputFields = ['customerCode', 'itemCode', 'materialCode', 'volume', 'quantity'];

export function orderError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

function validateInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw orderError(400, '주문 입력 형식이 올바르지 않습니다.');
  }
  if (typeof input.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.requestId)) {
    throw orderError(400, '요청ID 형식이 올바르지 않습니다.');
  }
  for (const field of ['customerCode', 'itemCode', 'materialCode']) {
    if (typeof input[field] !== 'string' || !input[field].trim()) {
      throw orderError(400, '거래처, 품목, 재질을 선택해 주세요.');
    }
  }
  if (typeof input.volume !== 'number' || !Number.isFinite(input.volume) || input.volume <= 0) {
    throw orderError(400, '부피는 0보다 큰 숫자여야 합니다.');
  }
  if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) {
    throw orderError(400, '수량은 계산 가능한 범위의 양의 정수여야 합니다.');
  }
}

// File and sources can be replaced for isolated verification without changing live data.
export function createOrderStore({
  file = fileURLToPath(new URL('./excel/주문내역.xlsx', import.meta.url)),
  customers = readCustomers, items = readItems, materials = readMaterials,
} = {}) {
  let pending = Promise.resolve();
  function exclusive(task) {
    const result = pending.then(task);
    pending = result.catch(() => {});
    return result;
  }

  async function readWorkbook() {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(file);
    const sheet = workbook.getWorksheet('주문');
    if (!sheet) throw new Error('주문 시트를 찾을 수 없습니다.');
    const columns = new Map();
    sheet.getRow(1).eachCell((cell, column) => {
      const header = cell.text.trim();
      if (columns.has(header)) throw new Error(`중복된 주문 열: ${header}`);
      columns.set(header, column);
    });
    for (const header of Object.values(fields)) {
      if (!columns.has(header)) throw new Error(`주문 필수 열 누락: ${header}`);
    }
    const orders = [];
    const ids = new Set();
    sheet.eachRow((row, index) => {
      if (index === 1 || !row.values.some(value => value !== null && value !== undefined && value !== '')) return;
      const order = Object.fromEntries(Object.entries(fields).map(([key, header]) => {
        const cell = row.getCell(columns.get(header));
        return [key, numericFields.has(key) ? cell.value : cell.text.trim()];
      }));
      if (!order.requestId || ids.has(order.requestId)) throw new Error('주문 요청ID 누락 또는 중복');
      ids.add(order.requestId);
      orders.push(order);
    });
    return { workbook, sheet, columns, orders };
  }

  return {
    list: () => exclusive(async () => (await readWorkbook()).orders),
    remove: requestId => exclusive(async () => {
      if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(requestId)) {
        throw orderError(400, '요청ID 형식이 올바르지 않습니다.');
      }
      let lock;
      const lockFile = `${file}.lock`;
      const tempFile = `${file}.${randomUUID()}.tmp`;
      try {
        try { lock = await open(lockFile, 'wx'); }
        catch (error) {
          if (error.code === 'EEXIST') throw orderError(503, '다른 저장 작업 중입니다. 잠시 후 다시 시도해 주세요.');
          throw error;
        }
        // Re-read under the lock: the displayed position is never a deletion key.
        const { workbook, sheet, columns, orders } = await readWorkbook();
        const order = orders.find(row => row.requestId === requestId);
        if (!order) throw orderError(404, '해당 요청ID의 주문을 찾을 수 없습니다.');
        let matchedRow;
        sheet.eachRow((row, index) => {
          if (index > 1 && row.getCell(columns.get(fields.requestId)).text.trim() === requestId) {
            matchedRow = index;
          }
        });
        if (!matchedRow) throw orderError(404, '해당 요청ID의 주문을 찾을 수 없습니다.');
        sheet.spliceRows(matchedRow, 1);
        await workbook.xlsx.writeFile(tempFile);
        await rename(tempFile, file);
        return order;
      } finally {
        await rm(tempFile, { force: true });
        if (lock) {
          await lock.close();
          await rm(lockFile, { force: true });
        }
      }
    }),
    save: input => exclusive(async () => {
      validateInput(input);
      let lock;
      const lockFile = `${file}.lock`;
      const tempFile = `${file}.${randomUUID()}.tmp`;
      try {
        try { lock = await open(lockFile, 'wx'); }
        catch (error) {
          if (error.code === 'EEXIST') throw orderError(503, '다른 저장 작업 중입니다. 잠시 후 같은 요청ID로 다시 시도해 주세요.');
          throw error;
        }
        const { workbook, sheet, columns, orders } = await readWorkbook();
        const existing = orders.find(order => order.requestId === input.requestId);
        if (existing) {
          if (inputFields.some(key => existing[key] !== input[key])) {
            throw orderError(409, '같은 요청ID에 다른 입력값이 이미 저장되어 있습니다.');
          }
          return { order: existing, created: false };
        }
        const [customerRows, itemRows, materialRows] = await Promise.all([customers(), items(), materials()]);
        const customer = customerRows.find(row => row.code === input.customerCode);
        const item = itemRows.find(row => row.code === input.itemCode);
        const material = materialRows.find(row => row.code === input.materialCode);
        if (!customer || !item || !material) throw orderError(400, '사용 가능한 거래처, 품목, 재질 코드를 다시 선택해 주세요.');
        const unitWeight = input.volume * material.density / 1000;
        const totalWeight = unitWeight * input.quantity;
        if (!Number.isFinite(unitWeight) || !Number.isFinite(totalWeight) || unitWeight <= 0 || totalWeight <= 0) {
          throw orderError(400, '계산 가능한 숫자 범위를 벗어났습니다.');
        }
        const order = {
          requestId: input.requestId, createdAt: new Date().toISOString(),
          customerCode: customer.code, customerName: customer.name, contact: customer.contact,
          itemCode: item.code, itemName: item.name, specification: item.specification,
          materialCode: material.code, materialName: material.name, density: material.density,
          volume: input.volume, quantity: input.quantity, unitWeight, totalWeight,
        };
        const values = [];
        for (const [key, header] of Object.entries(fields)) values[columns.get(header)] = order[key];
        const row = sheet.addRow(values);
        for (const key of numericFields) row.getCell(columns.get(fields[key])).numFmt = key === 'quantity' ? '0' : '0.######';
        // Replace only after the complete workbook has been written successfully.
        await workbook.xlsx.writeFile(tempFile);
        await rename(tempFile, file);
        return { order, created: true };
      } finally {
        await rm(tempFile, { force: true });
        if (lock) {
          await lock.close();
          await rm(lockFile, { force: true });
        }
      }
    }),
  };
}

export const orderStore = createOrderStore();
