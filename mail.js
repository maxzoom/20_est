import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { orderStore, orderError } from './orders.js';
import { readCustomers } from './customers.js';
import { sendSmtp, smtpInfo } from './smtp.js';

const hash = value => createHash('sha256').update(value).digest('hex');

function validateId(id) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw orderError(400, '요청ID 형식이 올바르지 않습니다.');
}

function recipientAddress(value) {
  if (typeof value !== 'string' || value.length > 254 || /[\r\n,;<>]/.test(value)) {
    throw orderError(400, '수신자는 이메일 주소 1개만 입력해 주세요.');
  }
  const address = value.trim();
  if (!/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/.test(address) ||
    address.split('@')[0].length > 64 || address.startsWith('.') || address.includes('..') || address.includes('.@')) {
    throw orderError(400, '올바른 수신자 이메일 주소 1개를 입력해 주세요.');
  }
  const [local, domain] = address.split('@');
  return `${local}@${domain.toLowerCase()}`;
}

export function createMailService({
  directory = fileURLToPath(new URL('./mail-previews/', import.meta.url)),
  getOrder = async id => (await orderStore.list()).find(order => order.requestId === id),
  getCustomer = async code => (await readCustomers(code)).find(customer => customer.code === code),
  sendMail = sendSmtp,
  getSmtpInfo = smtpInfo,
} = {}) {
  const inFlight = new Map();

  async function preview(id) {
    validateId(id);
    const order = await getOrder(id);
    if (!order) throw orderError(404, '저장된 주문을 찾을 수 없습니다. 주문을 먼저 저장해 주세요.');
    const customer = await getCustomer(order.customerCode);
    const defaultRecipient = typeof customer?.email === 'string' ? customer.email.trim() : '';
    const subject = `주문 내역 · ${order.requestId}`;
    const body = [
      '안녕하세요. 저장된 주문 내역을 안내드립니다.', '',
      `요청ID: ${order.requestId}`, `접수일시: ${order.createdAt}`,
      `거래처: ${order.customerCode} / ${order.customerName}`, `담당자: ${order.contact}`,
      `품목: ${order.itemCode} / ${order.itemName}`, `규격: ${order.specification}`,
      `재질: ${order.materialCode} / ${order.materialName}`, `적용 밀도: ${order.density} g/cm³`,
      `개당 부피: ${order.volume} cm³`, `수량: ${order.quantity}개`,
      `개당 중량: ${order.unitWeight} kg`, `총중량: ${order.totalWeight} kg`, '',
      '이 메일은 저장된 주문 기록을 기준으로 작성되었습니다.',
    ].join('\r\n');
    const smtp = getSmtpInfo();
    return { requestId: id, mode: 'preview', defaultRecipient, subject, body, version: hash(JSON.stringify({ subject, body })), smtpAvailable: smtp.available, smtpHost: smtp.host };
  }

  async function generate(id, input) {
    if (!input || input.mode !== 'preview') throw orderError(400, 'preview 모드만 지원합니다. 실제 메일은 발송하지 않습니다.');
    if (input.confirmed !== true) throw orderError(400, '수신자와 본문을 먼저 확인해 주세요.');
    const recipient = recipientAddress(input.recipient);
    const draft = await preview(id);
    if (input.version !== draft.version) throw orderError(409, '저장 기록이 변경되었습니다. 미리보기를 다시 열어 본문을 확인해 주세요.');
    const key = hash(JSON.stringify([id, recipient, draft.version, 'preview']));
    if (inFlight.has(key)) {
      const result = await inFlight.get(key);
      return { ...result, duplicate: true };
    }
    const task = (async () => {
      await mkdir(directory, { recursive: true });
      const file = path.join(directory, `${key}.eml`);
      const temp = path.join(directory, `${key}.${randomUUID()}.tmp`);
      const result = { requestId: id, mode: 'preview', sent: false, recipient, downloadUrl: `/api/mail-previews/${key}`, duplicate: false };
      let lock;
      try {
        try {
          lock = await open(`${file}.lock`, 'wx');
        } catch (error) {
          if (error.code === 'EEXIST') throw orderError(503, '같은 메일을 처리 중입니다. 잠시 후 다시 시도해 주세요.');
          throw error;
        }
        try {
          await readFile(file);
          return { ...result, duplicate: true };
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
        const encodedBody = Buffer.from(draft.body, 'utf8').toString('base64').match(/.{1,76}/g).join('\r\n');
        const encodedSubject = Buffer.from('주문 내역 ·', 'utf8').toString('base64');
        const eml = [
          'From: ESTIMATE Preview <preview@example.invalid>', `To: ${recipient}`,
          `Subject: =?UTF-8?B?${encodedSubject}?=`, ` ${id}`,
          `Date: ${new Date().toUTCString()}`, `Message-ID: <${key}@estimate.invalid>`,
          'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8',
          'Content-Transfer-Encoding: base64', 'X-Unsent: 1', 'X-Estimate-Mode: preview', '', encodedBody, '',
        ].join('\r\n');
        const handle = await open(temp, 'wx');
        try { await handle.writeFile(eml, 'utf8'); await handle.sync(); }
        finally { await handle.close(); }
        await rename(temp, file);
        return result;
      } finally {
        await rm(temp, { force: true });
        if (lock) { await lock.close(); await rm(`${file}.lock`, { force: true }); }
      }
    })();
    inFlight.set(key, task);
    try { return await task; }
    finally { inFlight.delete(key); }
  }

  async function send(id, input) {
    if (!input || input.mode !== 'smtp' || input.confirmed !== true || input.sendConfirmed !== true) {
      throw orderError(400, '수신자와 본문을 확인하고 실제 메일 발송 버튼을 눌러 주세요.');
    }
    const recipient = recipientAddress(input.recipient);
    const draft = await preview(id);
    if (input.version !== draft.version) throw orderError(409, '저장 기록이 변경되었습니다. 본문을 다시 읽고 확인해 주세요.');
    if (!getSmtpInfo().available) throw orderError(503, 'SMTP 설정이 완료되지 않았습니다. 서버의 .env를 확인해 주세요.');
    const key = hash(JSON.stringify([id, recipient, draft.version, 'smtp']));
    if (inFlight.has(key)) return { ...await inFlight.get(key), duplicate: true };
    const task = (async () => {
      await mkdir(directory, { recursive: true });
      const file = path.join(directory, `${key}.json`);
      const temp = path.join(directory, `${key}.${randomUUID()}.tmp`);
      let lock;
      async function record(value) {
        const handle = await open(temp, 'w');
        try { await handle.writeFile(JSON.stringify(value), 'utf8'); await handle.sync(); }
        finally { await handle.close(); }
        await rename(temp, file);
      }
      const result = { requestId: id, mode: 'smtp', sent: true, recipient, duplicate: false };
      try {
        try { lock = await open(`${file}.lock`, 'wx'); }
        catch (error) {
          if (error.code === 'EEXIST') throw orderError(409, '같은 메일의 발송 작업 중입니다. 중복 발송을 막기 위해 기다려 주세요.');
          throw error;
        }
        let previous;
        try { previous = JSON.parse(await readFile(file, 'utf8')); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (previous?.status === 'sent') return { ...previous.result, duplicate: true };
        if (previous && previous.status !== 'failed') {
          throw orderError(409, '이 메일은 발송 중이거나 결과 확인이 필요합니다. 중복 발송을 막기 위해 재발송하지 않습니다. 메일 서버의 발송 내역을 확인해 주세요.');
        }
        await record({ status: 'sending', requestId: id, recipient, startedAt: new Date().toISOString() });
        let info;
        try {
          info = await sendMail({ recipient, subject: draft.subject, body: draft.body, messageId: `<${key}@estimate.invalid>` });
        } catch (error) {
          const retrySafe = error.retrySafe === true;
          await record({ status: retrySafe ? 'failed' : 'unknown', requestId: id, recipient, updatedAt: new Date().toISOString() });
          throw orderError(502, retrySafe ? 'SMTP 서버가 메일을 접수하지 못했습니다. 계정·포트·TLS 설정을 확인한 뒤 다시 시도해 주세요.' : '발송 결과를 확인하지 못했습니다. 중복 발송을 막기 위해 재발송을 보류합니다. 메일 서버의 발송 내역을 확인해 주세요.');
        }
        const completed = { ...result, messageId: info.messageId, sentAt: new Date().toISOString() };
        await record({ status: 'sent', result: completed });
        return completed;
      } finally {
        await rm(temp, { force: true });
        if (lock) { await lock.close(); await rm(`${file}.lock`, { force: true }); }
      }
    })();
    inFlight.set(key, task);
    try { return await task; }
    finally { inFlight.delete(key); }
  }

  async function download(key) {
    if (!/^[a-f0-9]{64}$/.test(key)) throw orderError(400, '미리보기 파일 ID가 올바르지 않습니다.');
    try { return await readFile(path.join(directory, `${key}.eml`)); }
    catch (error) {
      if (error.code === 'ENOENT') throw orderError(404, '미리보기 파일을 찾을 수 없습니다.');
      throw error;
    }
  }

  return { preview, generate, send, download };
}

export const mailService = createMailService();
