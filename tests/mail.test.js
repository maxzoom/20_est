import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createMailService } from '../mail.js';

const saved = {
  requestId: 'saved-order', createdAt: '2026-11-25T00:00:00.000Z',
  customerCode: 'C1', customerName: '저장된 거래처', contact: '담당자',
  itemCode: 'I1', itemName: '저장된 품목', specification: 'DN100',
  materialCode: 'M1', materialName: '탄소강', density: 7.85,
  volume: 1250, quantity: 20, unitWeight: 9.8125, totalWeight: 196.25,
};

test('saved snapshot, explicit single-recipient confirmation, MIME, concurrency and durable deduplication', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'estimate-mail-'));
  const directory = path.join(dir, 'previews');
  let order = { ...saved };
  const options = { directory, getOrder: async id => id === saved.requestId ? order : undefined, getCustomer: async () => undefined };
  const mail = createMailService(options);
  try {
    const draft = await mail.preview(saved.requestId);
    assert.equal(draft.mode, 'preview');
    assert.ok(draft.body.includes('저장된 거래처'));
    assert.ok(draft.body.includes('196.25 kg'));
    const input = { mode: 'preview', recipient: 'one@example.com', confirmed: true, version: draft.version };
    for (const invalid of [
      { ...input, mode: 'send' }, { ...input, confirmed: false },
      { ...input, recipient: ['a@example.com', 'b@example.com'] },
      { ...input, recipient: 'a@example.com,b@example.com' },
      { ...input, recipient: 'a@example.com\r\nBcc: b@example.com' },
      { ...input, recipient: 'a@example.com;b@example.com' },
    ]) await assert.rejects(mail.generate(saved.requestId, invalid), { statusCode: 400 });
    await assert.rejects(mail.generate(saved.requestId, { ...input, version: 'stale' }), { statusCode: 409 });
    await assert.rejects(mail.preview('missing'), { statusCode: 404 });
    const [a, b] = await Promise.all([mail.generate(saved.requestId, input), mail.generate(saved.requestId, input)]);
    assert.equal(a.sent, false); assert.equal(b.sent, false);
    assert.equal(a.mode, 'preview');
    assert.equal(a.downloadUrl, b.downloadUrl);
    assert.equal([a, b].filter(result => result.duplicate).length, 1);
    const key = a.downloadUrl.split('/').at(-1);
    const eml = await mail.download(key);
    const text = eml.toString('utf8');
    assert.ok(text.includes('To: one@example.com\r\n'));
    assert.ok(!text.includes('\r\nCc:')); assert.ok(!text.includes('\r\nBcc:'));
    assert.ok(text.includes('X-Unsent: 1\r\nX-Estimate-Mode: preview'));
    assert.equal(Buffer.from(text.split('\r\n\r\n')[1].replace(/\s/g, ''), 'base64').toString('utf8'), draft.body);
    assert.deepEqual(order, saved);
    const before = await readFile(path.join(directory, `${key}.eml`));
    const restarted = createMailService(options);
    assert.equal((await restarted.generate(saved.requestId, input)).duplicate, true);
    assert.deepEqual(await readFile(path.join(directory, `${key}.eml`)), before);
    assert.deepEqual(await readdir(directory), [`${key}.eml`]);
    order = { ...order, quantity: 21 };
    await assert.rejects(mail.generate(saved.requestId, input), { statusCode: 409 });
    order = undefined;
    await assert.rejects(mail.generate(saved.requestId, input), { statusCode: 404 });
    await assert.rejects(mail.download('../escape'), { statusCode: 400 });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('write failure keeps order intact and allows a safe retry', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'estimate-mail-failure-'));
  const directory = path.join(dir, 'blocked');
  const order = { ...saved };
  const mail = createMailService({ directory, getOrder: async () => order, getCustomer: async () => undefined });
  try {
    await writeFile(directory, 'blocked');
    const draft = await mail.preview(saved.requestId);
    const input = { mode: 'preview', recipient: 'one@example.com', confirmed: true, version: draft.version };
    await assert.rejects(mail.generate(saved.requestId, input));
    assert.deepEqual(order, saved);
    await rm(directory);
    const retry = await mail.generate(saved.requestId, input);
    assert.equal(retry.sent, false);
    assert.equal(retry.duplicate, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('default recipient uses saved customer code and latest customer email; missing email stays empty', async () => {
  let email = ' customer@example.com ';
  const mail = createMailService({
    getOrder: async () => ({ ...saved }),
    getCustomer: async code => {
      assert.equal(code, saved.customerCode);
      return { code, email };
    },
  });
  assert.equal((await mail.preview(saved.requestId)).defaultRecipient, 'customer@example.com');
  email = 'updated@example.com';
  assert.equal((await mail.preview(saved.requestId)).defaultRecipient, 'updated@example.com');
  email = '';
  assert.equal((await mail.preview(saved.requestId)).defaultRecipient, '');
  const missing = createMailService({ getOrder: async () => ({ ...saved }), getCustomer: async () => undefined });
  assert.equal((await missing.preview(saved.requestId)).defaultRecipient, '');
});

test('SMTP explicit confirmation, saved content, concurrency and restart duplicate prevention', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'estimate-smtp-'));
  let count = 0;
  const options = {
    directory, getOrder: async () => ({ ...saved }), getCustomer: async () => undefined,
    getSmtpInfo: () => ({ available: true, host: 'smtp.example.test' }),
    sendMail: async message => {
      count += 1;
      assert.ok(message.body.includes('저장된 거래처'));
      assert.ok(message.body.includes('196.25 kg'));
      assert.equal(message.recipient, 'one@example.com');
      return { messageId: message.messageId };
    },
  };
  try {
    const mail = createMailService(options);
    const draft = await mail.preview(saved.requestId);
    assert.equal(draft.smtpAvailable, true);
    const input = { mode: 'smtp', recipient: 'one@example.com', confirmed: true, sendConfirmed: true, version: draft.version };
    await assert.rejects(mail.send(saved.requestId, { ...input, sendConfirmed: false }), { statusCode: 400 });
    await assert.rejects(mail.send(saved.requestId, { ...input, version: 'stale' }), { statusCode: 409 });
    assert.equal(count, 0);
    const results = await Promise.all([mail.send(saved.requestId, input), mail.send(saved.requestId, input)]);
    assert.equal(count, 1);
    assert.ok(results.every(result => result.sent && result.mode === 'smtp'));
    assert.equal(results.filter(result => result.duplicate).length, 1);
    assert.equal((await createMailService(options).send(saved.requestId, input)).duplicate, true);
    assert.equal(count, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('SMTP known failure retries, ambiguous outcome blocks repeat delivery and keeps saved order', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'estimate-smtp-failure-'));
  let count = 0;
  let retrySafe = true;
  const order = { ...saved };
  const options = {
    directory, getOrder: async () => order, getCustomer: async () => undefined,
    getSmtpInfo: () => ({ available: true, host: 'smtp.example.test' }),
    sendMail: async () => { count += 1; throw Object.assign(new Error('failure'), { retrySafe }); },
  };
  try {
    const mail = createMailService(options);
    const draft = await mail.preview(saved.requestId);
    const input = { mode: 'smtp', recipient: 'one@example.com', confirmed: true, sendConfirmed: true, version: draft.version };
    await assert.rejects(mail.send(saved.requestId, input), { statusCode: 502 }); assert.equal(count, 1);
    retrySafe = false;
    await assert.rejects(mail.send(saved.requestId, input), { statusCode: 502 }); assert.equal(count, 2);
    await assert.rejects(createMailService(options).send(saved.requestId, input), { statusCode: 409 }); assert.equal(count, 2);
    assert.deepEqual(order, saved);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
