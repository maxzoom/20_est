import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { readMaterials } from './materials.js';
import { readStorageHealth } from './health.js';
import { readItems } from './items.js';
import { readCustomers } from './customers.js';
import { orderStore, orderError } from './orders.js';
import { mailService } from './mail.js';

const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || 3000);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

const staticFiles = new Map([
  ['/', { file: 'index.html', contentType: 'text/html; charset=utf-8' }],
  ['/index.html', { file: 'index.html', contentType: 'text/html; charset=utf-8' }],
  ['/styles.css', { file: 'styles.css', contentType: 'text/css; charset=utf-8' }],
  ['/app.js', { file: 'app.js', contentType: 'text/javascript; charset=utf-8' }],
]);

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(body, null, 2));
}

async function readJson(request) {
  if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw orderError(415, 'JSON 형식으로 보내 주세요.');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16384) throw orderError(413, '요청 데이터가 너무 큽니다.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw orderError(400, 'JSON 형식이 올바르지 않습니다.'); }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const pathname = url.pathname.replace(/\/+$/, '') || '/';

  const staticFile = staticFiles.get(pathname);
  if (staticFile) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      sendJson(response, 405, { error: 'Method not allowed' });
      return;
    }
    try {
      const content = await readFile(new URL(`./public/${staticFile.file}`, import.meta.url));
      response.writeHead(200, {
        'Content-Type': staticFile.contentType,
        'Cache-Control': 'no-store',
      });
      response.end(request.method === 'HEAD' ? undefined : content);
    } catch (error) {
      console.error('Failed to load static file:', error.message);
      sendJson(response, 500, { error: '화면 파일을 불러올 수 없습니다.' });
    }
    return;
  }

  if (pathname === '/api/health') {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      sendJson(response, 405, { error: 'Method not allowed' });
      return;
    }

    try {
      sendJson(response, 200, await readStorageHealth());
    } catch (error) {
      console.error('Storage health check failed:', error.message);
      sendJson(response, 503, { status: 'error', error: '엑셀 저장소를 확인할 수 없습니다.' });
    }
    return;
  }

  if (pathname === '/api/materials') {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      sendJson(response, 405, { error: 'Method not allowed' });
      return;
    }

    try {
      const materials = await readMaterials();
      sendJson(response, 200, materials);
    } catch (error) {
      console.error('Failed to read materials:', error.message);
      sendJson(response, 500, { error: '재질 목록을 읽을 수 없습니다.' });
    }
    return;
  }

  if (pathname === '/api/items') {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      sendJson(response, 405, { error: 'Method not allowed' });
      return;
    }
    try {
      sendJson(response, 200, await readItems(url.searchParams.get('q') || ''));
    } catch (error) {
      console.error('Failed to read items:', error.message);
      sendJson(response, 500, { error: '품목 목록을 읽을 수 없습니다.' });
    }
    return;
  }

  if (pathname === '/api/customers') {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      sendJson(response, 405, { error: 'Method not allowed' });
      return;
    }
    try {
      sendJson(response, 200, await readCustomers(url.searchParams.get('q') || ''));
    } catch (error) {
      console.error('Failed to read customers:', error.message);
      sendJson(response, 500, { error: '거래처 목록을 읽을 수 없습니다.' });
    }
    return;
  }

  const mailRoute = pathname.match(/^\/api\/orders\/([^/]+)\/(email-preview|email)$/);
  const mailDownload = pathname.match(/^\/api\/mail-previews\/([^/]+)$/);
  if (mailRoute || mailDownload) {
    const allowed = mailRoute?.[2] === 'email' ? ['POST'] : ['GET', 'HEAD'];
    if (!allowed.includes(request.method)) {
      response.setHeader('Allow', allowed.join(', '));
      sendJson(response, 405, { error: 'Method not allowed' });
      return;
    }
    try {
      if (mailDownload) {
        const content = await mailService.download(mailDownload[1]);
        response.writeHead(200, {
          'Content-Type': 'message/rfc822', 'Cache-Control': 'no-store',
          'Content-Disposition': `attachment; filename="preview-${mailDownload[1]}.eml"`,
          'X-Content-Type-Options': 'nosniff',
        });
        response.end(request.method === 'HEAD' ? undefined : content);
      } else {
        let id;
        try { id = decodeURIComponent(mailRoute[1]); }
        catch { throw orderError(400, '요청ID 형식이 올바르지 않습니다.'); }
        if (mailRoute[2] === 'email-preview') sendJson(response, 200, await mailService.preview(id));
        else {
          const input = await readJson(request);
          const result = input?.mode === 'smtp' ? await mailService.send(id, input) : await mailService.generate(id, input);
          sendJson(response, result.duplicate ? 200 : 201, result);
        }
      }
    } catch (error) {
      console.error('Mail preview failed:', error.code || error.statusCode || 'unknown');
      sendJson(response, error.statusCode || 503, {
        error: error.statusCode ? error.message : '메일 미리보기를 만들지 못했습니다. 주문과 입력은 유지됩니다. 다시 시도해 주세요.',
      });
    }
    return;
  }

  const orderById = pathname.match(/^\/api\/orders\/([^/]+)$/);
  if (orderById) {
    if (request.method !== 'DELETE') {
      response.setHeader('Allow', 'DELETE');
      sendJson(response, 405, { error: 'Method not allowed' });
      return;
    }
    try {
      let requestId;
      try { requestId = decodeURIComponent(orderById[1]); }
      catch { throw orderError(400, '요청ID 형식이 올바르지 않습니다.'); }
      const order = await orderStore.remove(requestId);
      sendJson(response, 200, { requestId: order.requestId, deleted: true });
    } catch (error) {
      console.error('Order deletion failed:', error.message);
      sendJson(response, error.statusCode || 503, {
        error: error.statusCode ? error.message : '주문을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      });
    }
    return;
  }

  if (pathname === '/api/orders') {
    if (!['GET', 'HEAD', 'POST'].includes(request.method)) {
      response.setHeader('Allow', 'GET, HEAD, POST');
      sendJson(response, 405, { error: 'Method not allowed' });
      return;
    }
    try {
      if (request.method === 'POST') {
        const result = await orderStore.save(await readJson(request));
        sendJson(response, result.created ? 201 : 200, result.order);
      } else {
        sendJson(response, 200, await orderStore.list());
      }
    } catch (error) {
      console.error('Order operation failed:', error.message);
      sendJson(response, error.statusCode || 503, {
        error: error.statusCode ? error.message : '주문 파일을 읽거나 저장하지 못했습니다. 입력값을 유지한 채 다시 시도해 주세요.',
      });
    }
    return;
  }

  sendJson(response, 404, { error: 'Not found' });
});

server.on('error', (error) => {
  console.error(`Server failed: ${error.message}`);
  process.exitCode = 1;
});

server.listen(port, host, () => {
  console.log(`Server running at http://${host}:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close());
}
