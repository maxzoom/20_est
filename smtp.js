import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import nodemailer from 'nodemailer';
import { orderError } from './orders.js';

try { loadEnvFile(fileURLToPath(new URL('./.env', import.meta.url))); }
catch (error) { if (error.code !== 'ENOENT') throw new Error('.env 파일 형식을 확인해 주세요.'); }

export function smtpConfig(env = process.env) {
  const host = env.SMTP_HOST?.trim() || '';
  const port = Number(env.SMTP_PORT || 587);
  const user = env.SMTP_USER?.trim() || '';
  const from = env.MAIL_FROM?.trim() || user;
  const pass = env.SMTP_PASS || '';
  const validAddress = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
  const available = !!host && Number.isInteger(port) && port > 0 && port <= 65535 &&
    !!user && !!pass && validAddress.test(from) && !/[\r\n]/.test(from);
  return {
    available, host, from, fromName: env.MAIL_FROM_NAME || 'ESTIMATE',
    transport: {
      host, port, secure: env.SMTP_SECURE === 'true', requireTLS: env.SMTP_REQUIRE_TLS !== 'false',
      auth: { user, pass }, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
      logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true,
    },
  };
}

export function smtpInfo() {
  const config = smtpConfig();
  return { available: config.available, host: config.host };
}

export async function sendSmtp({ recipient, subject, body, messageId }, config = smtpConfig()) {
  if (!config.available) throw orderError(503, 'SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM 설정을 확인해 주세요.');
  const transport = nodemailer.createTransport(config.transport);
  try {
    const info = await transport.sendMail({
      from: { name: config.fromName, address: config.from }, to: recipient,
      envelope: { from: config.from, to: [recipient] }, subject, text: body, messageId,
    });
    if (!info.accepted?.length || info.rejected?.length) {
      throw Object.assign(new Error('수신자 거부'), { responseCode: 550 });
    }
    return { messageId: info.messageId };
  } catch (error) {
    // A lost connection after DATA can mean the server accepted the message.
    const retrySafe = (error.responseCode >= 400 && error.responseCode <= 599) ||
      ['EAUTH', 'ECONNECTION', 'EDNS', 'ETLS'].includes(error.code) ||
      ['CONN', 'EHLO', 'HELO', 'STARTTLS', 'AUTH', 'MAIL FROM', 'RCPT TO'].includes(error.command);
    throw Object.assign(new Error('SMTP 처리 실패'), { retrySafe });
  } finally { transport.close(); }
}
