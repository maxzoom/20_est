import ExcelJS from 'exceljs';
import { fileURLToPath } from 'node:url';

const materialsFile = fileURLToPath(new URL('./excel/재질정보.xlsx', import.meta.url));

export async function readMaterials() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(materialsFile);
  const sheet = workbook.getWorksheet('재질');
  if (!sheet) throw new Error('재질 시트를 찾을 수 없습니다.');

  const columns = new Map();
  sheet.getRow(1).eachCell((cell, index) => {
    const header = cell.text.trim();
    if (columns.has(header)) throw new Error(`중복된 열: ${header}`);
    columns.set(header, index);
  });
  for (const header of ['재질코드', '재질명', '계산용밀도_g_cm3', '사용여부']) {
    if (!columns.has(header)) throw new Error(`필수 열 누락: ${header}`);
  }

  const materials = [];
  const codes = new Set();
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const getCell = (header) => row.getCell(columns.get(header));
    if (getCell('사용여부').text.trim() !== 'Y') return;

    const code = getCell('재질코드').text.trim();
    const name = getCell('재질명').text.trim();
    const density = getCell('계산용밀도_g_cm3').value;
    if (!code || !name || typeof density !== 'number' || !Number.isFinite(density) || density <= 0) {
      throw new Error(`재질 데이터 오류: ${rowNumber}행`);
    }
    if (codes.has(code)) throw new Error(`중복된 재질코드: ${code}`);
    codes.add(code);
    materials.push({ code, name, density });
  });
  return materials;
}
