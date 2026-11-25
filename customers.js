import ExcelJS from 'exceljs';
import { fileURLToPath } from 'node:url';

const customersFile = fileURLToPath(new URL('./excel/거래처내역.xlsx', import.meta.url));

export async function readCustomers(query = '') {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(customersFile);
  const sheet = workbook.getWorksheet('거래처');
  if (!sheet) throw new Error('거래처 시트를 찾을 수 없습니다.');

  const columns = new Map();
  sheet.getRow(1).eachCell((cell, index) => {
    const header = cell.text.trim();
    if (columns.has(header)) throw new Error(`중복된 열: ${header}`);
    columns.set(header, index);
  });
  for (const header of ['거래처코드', '거래처명', '담당자', '이메일', '사용여부']) {
    if (!columns.has(header)) throw new Error(`필수 열 누락: ${header}`);
  }

  const search = query.trim().toLocaleLowerCase('ko-KR');
  const customers = [];
  const codes = new Set();
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const text = header => row.getCell(columns.get(header)).text.trim();
    if (text('사용여부') !== 'Y') return;
    const code = text('거래처코드');
    const name = text('거래처명');
    const contact = text('담당자');
    const email = text('이메일');
    if (!code || !name) throw new Error(`거래처 데이터 오류: ${rowNumber}행`);
    if (codes.has(code)) throw new Error(`중복된 거래처코드: ${code}`);
    codes.add(code);
    if ([code, name, contact].some(value => value.toLocaleLowerCase('ko-KR').includes(search))) {
      customers.push({ code, name, contact, email });
    }
  });
  return customers;
}
