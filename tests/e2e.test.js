const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const requestHandler = require('../server.js');

let server;
let port;

test.before(async () => {
  server = http.createServer(requestHandler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    port = server.address().port;
    resolve();
  }));
});

test.after(() => {
  if (server) server.close();
});

test('GET /api/status renvoie les infos de clé et de provider', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/api/status`);
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.ok(data.omnirouteOnline || data.activeProvider !== undefined);
  assert.ok(data.hasKeychainKey !== undefined);
});

test('POST /api/analyze rejette une payload sans image valide', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageBase64: 'invalid' })
  });
  assert.strictEqual(res.status, 400);
  const data = await res.json();
  assert.match(data.error, /capture d'écran valide/i);
});

test('GET / renvoie la page index.html', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/`);
  assert.strictEqual(res.status, 200);
  const html = await res.text();
  assert.match(html, /OmniRoute Trading Desk/i);
});

test('POST /api/telegram/send valide les champs requis', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/api/telegram/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'test' })
  });
  assert.strictEqual(res.status, 400);
  const data = await res.json();
  assert.match(data.error, /botToken, chatId et message requis/i);
});

test('GET /api/mt5/orders renvoie l’état de la passerelle MT5', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/api/mt5/orders`);
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(typeof data.has_order, 'boolean');
});
