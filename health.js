import ExcelJS from 'exceljs';
import { fileURLToPath } from 'node:url';

const sources = [
  { key: 'customers', file: '거래처내역.xlsx', sheet: '거래처', id: '거래처코드' },
  { key: 'items', file: '품목내역.xlsx', sheet: '품목', id: '품목코드' },
  { key: 'materials', file: '재질정보.xlsx', sheet: '재질', id: '재질코드' },
  { key: 'orders', file: '주문내역.xlsx', sheet: '주문', id: '요청ID' },
];

export async function readStorageHealth() {
  const entries = await Promise.all(sources.map(async (source) => {
    const workbook = new ExcelJS.Workbook();
    const path = fileURLToPath(new URL(`./excel/${source.file}`, import.meta.url));
    await workbook.xlsx.readFile(path);
    const sheet = workbook.getWorksheet(source.sheet);
    if (!sheet) throw new Error(`${source.file}: ${source.sheet} 시트 누락`);

    let idColumn;
    sheet.getRow(1).eachCell((cell, column) => {
      if (cell.text.trim() === source.id) idColumn = column;
    });
    if (!idColumn) throw new Error(`${source.file}: ${source.id} 열 누락`);

    let count = 0;
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      let populated = false;
      row.eachCell((cell) => {
        if (cell.text.trim() !== '') populated = true;
      });
      if (!populated) return;
      if (!row.getCell(idColumn).text.trim()) {
        throw new Error(`${source.file}: ${rowNumber}행 식별자 누락`);
      }
      count += 1;
    });
    return [source.key, count];
  }));

  return {
    status: 'ok',
    storage: 'Excel 4 files',
    counts: Object.fromEntries(entries),
  };
}
