import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import { smtpConfig, sendSmtp } from '../smtp.js';

test('SMTP transport delivers to a local test server with one recipient and configured sender', async () => {
  let recipients = [];
  let message = '';
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    socket.write('220 localhost SMTP test\r\n');
    let buffer = ''; let inData = false;
    socket.on('data', chunk => {
      buffer += chunk.toString();
      let end;
      while ((end = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        if (inData) {
          if (line === '.') { inData = false; socket.write('250 accepted\r\n'); }
          else message += `${line}\r\n`;
        } else if (/^EHLO/.test(line)) socket.write('250-localhost\r\n250 AUTH PLAIN\r\n');
        else if (/^AUTH /.test(line)) socket.write('235 authenticated\r\n');
        else if (/^MAIL FROM:/.test(line)) { assert.match(line, /sender@example.test/i); socket.write('250 OK\r\n'); }
        else if (/^RCPT TO:/.test(line)) { recipients.push(line); socket.write('250 OK\r\n'); }
        else if (line === 'DATA') { inData = true; socket.write('354 enter message\r\n'); }
        else if (line === 'QUIT') socket.end('221 bye\r\n');
        else socket.write('250 OK\r\n');
      }
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const config = smtpConfig({ SMTP_HOST: '127.0.0.1', SMTP_PORT: String(server.address().port), SMTP_USER: 'sender@example.test', SMTP_PASS: 'test-only', SMTP_SECURE: 'false', SMTP_REQUIRE_TLS: 'false' });
    assert.equal(config.available, true); assert.equal(config.from, 'sender@example.test');
    const info = await sendSmtp({ recipient: 'one@example.test', subject: 'Test subject', body: 'Stored order body', messageId: '<test@example.test>' }, config);
    assert.equal(info.messageId, '<test@example.test>');
    assert.equal(recipients.length, 1); assert.match(recipients[0], /one@example.test/);
    assert.ok(message.includes('Stored order body')); assert.ok(message.includes('Subject: Test subject'));
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  }
});
