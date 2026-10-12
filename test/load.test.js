/**
 * Load test: N authenticated clients join one room, then M messages are sent
 * from random clients. Every client should receive every message. Measures
 * broadcast latency (send -> receive, per recipient) and dropped deliveries.
 *
 * The server runs in a separate process so client-side work doesn't skew
 * server timings.
 *
 * Run with: npm run test:load
 * Tune with env vars: CLIENTS (default 100), MESSAGES (default 200), INTERVAL_MS (default 10)
 */
const { spawn } = require('child_process');
const path = require('path');
const { io: Client } = require('socket.io-client');

const PORT = 4998;
const BASE = `http://localhost:${PORT}`;
const CLIENTS = Number(process.env.CLIENTS || 100);
const MESSAGES = Number(process.env.MESSAGES || 200);
const INTERVAL_MS = Number(process.env.INTERVAL_MS || 10);
const ROOM = 'load-test';

async function main() {
  const serverProc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve) => {
    serverProc.stdout.on('data', (chunk) => { if (String(chunk).includes('listening')) resolve(); });
  });

  try {
    console.log(`Registering ${CLIENTS} users...`);
    const runId = Date.now();
    const users = [];
    for (let i = 0; i < CLIENTS; i++) {
      users.push(await register(`load_${runId}_${i}`, 'password123'));
    }

    const sockets = users.map((u) => Client(BASE, { auth: { token: u.token }, transports: ['websocket'] }));
    await Promise.all(sockets.map((s) => once(s, 'connect')));
    await Promise.all(
      sockets.map((s) => {
        const p = once(s, 'room_history');
        s.emit('join_room', { roomName: ROOM });
        return p;
      })
    );
    console.log(`✓ ${CLIENTS} concurrent WebSocket connections authenticated and joined '${ROOM}'`);

    const sentAt = new Map(); // message tag -> send timestamp
    const latencies = [];
    let received = 0;
    let unexpected = 0;

    for (const s of sockets) {
      s.on('new_message', (msg) => {
        const t = sentAt.get(msg.text);
        if (t === undefined) { unexpected++; return; }
        latencies.push(performance.now() - t);
        received++;
      });
    }

    const expected = MESSAGES * CLIENTS;
    const done = new Promise((resolve) => {
      const check = setInterval(() => { if (received >= expected) { clearInterval(check); resolve(); } }, 5);
      setTimeout(() => { clearInterval(check); resolve(); }, 15000 + MESSAGES * INTERVAL_MS);
    });

    const start = performance.now();
    for (let i = 0; i < MESSAGES; i++) {
      const tag = `load-msg-${i}`;
      const sender = sockets[Math.floor(Math.random() * CLIENTS)];
      sentAt.set(tag, performance.now());
      sender.emit('send_message', { roomName: ROOM, text: tag });
      await sleep(INTERVAL_MS);
    }
    await done;
    const elapsed = (performance.now() - start) / 1000;

    latencies.sort((a, b) => a - b);
    const pct = (p) => latencies[Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length))];
    const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const dropped = expected - received;

    console.log('\n--- Results ---');
    console.log(`Clients:              ${CLIENTS}`);
    console.log(`Messages sent:        ${MESSAGES} (every ${INTERVAL_MS}ms)`);
    console.log(`Deliveries expected:  ${expected}`);
    console.log(`Deliveries received:  ${received}`);
    console.log(`Dropped:              ${dropped}`);
    console.log(`Throughput:           ${(received / elapsed).toFixed(0)} deliveries/sec`);
    console.log(`Broadcast latency:    avg ${avg.toFixed(2)}ms | p50 ${pct(50).toFixed(2)}ms | p95 ${pct(95).toFixed(2)}ms | p99 ${pct(99).toFixed(2)}ms | max ${latencies[latencies.length - 1].toFixed(2)}ms`);

    sockets.forEach((s) => s.close());
    if (dropped !== 0 || unexpected !== 0) {
      console.error(`\nLOAD TEST FAILED: ${dropped} dropped, ${unexpected} unexpected`);
      process.exitCode = 1;
    } else {
      console.log('\nLOAD TEST PASSED: zero dropped messages');
    }
  } finally {
    serverProc.kill();
  }
}

async function register(username, password) {
  const res = await fetch(`${BASE}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data;
}

function once(socket, event) {
  return new Promise((resolve, reject) => {
    socket.once(event, resolve);
    if (event === 'connect') socket.once('connect_error', reject);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

main().catch((err) => {
  console.error('LOAD TEST FAILED:', err);
  process.exit(1);
});
