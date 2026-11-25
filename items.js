import ExcelJS from 'exceljs';
import { fileURLToPath } from 'node:url';

const itemsFile = fileURLToPath(new URL('./excel/품목내역.xlsx', import.meta.url));

export async function readItems(query = '') {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(itemsFile);
  const sheet = workbook.getWorksheet('품목');
  if (!sheet) throw new Error('품목 시트를 찾을 수 없습니다.');

  const columns = new Map();
  sheet.getRow(1).eachCell((cell, index) => {
    const header = cell.text.trim();
    if (columns.has(header)) throw new Error(`중복된 열: ${header}`);
    columns.set(header, index);
  });
  for (const header of ['품목코드', '품목명', '규격', '단위', '사용여부']) {
    if (!columns.has(header)) throw new Error(`필수 열 누락: ${header}`);
  }

  const search = query.trim().toLocaleLowerCase('ko-KR');
  const items = [];
  const codes = new Set();
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const text = (header) => row.getCell(columns.get(header)).text.trim();
    if (text('사용여부') !== 'Y') return;
    const code = text('품목코드');
    const name = text('품목명');
    const specification = text('규격');
    const unit = text('단위');
    if (!code || !name) throw new Error(`품목 데이터 오류: ${rowNumber}행`);
    if (codes.has(code)) throw new Error(`중복된 품목코드: ${code}`);
    codes.add(code);
    if ([code, name, specification].some(value => value.toLocaleLowerCase('ko-KR').includes(search))) {
      items.push({ code, name, specification, unit });
    }
  });
  return items;
}
