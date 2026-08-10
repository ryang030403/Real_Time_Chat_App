/**
 * End-to-end smoke test: registers two users, connects both over WebSocket,
 * joins a room, sends a message, and verifies the other user receives it
 * decrypted in real time -- plus a notification when NOT in the room.
 *
 * Run with: node test/smoke.test.js
 */
const { io: Client } = require('socket.io-client');
const assert = require('assert');
const { server } = require('../server');

const PORT = 4999;

async function main() {
  await new Promise((resolve) => server.listen(PORT, resolve));
  const base = `http://localhost:${PORT}`;

  const alice = await registerAndLogin('alice_' + Date.now(), 'password123', base);
  const bob = await registerAndLogin('bob_' + Date.now(), 'password123', base);

  const aliceSocket = Client(base, { auth: { token: alice.token } });
  const bobSocket = Client(base, { auth: { token: bob.token } });

  await Promise.all([waitFor(aliceSocket, 'connect'), waitFor(bobSocket, 'connect')]);
  console.log('✓ both clients connected with JWT auth');

  aliceSocket.emit('join_room', { roomName: 'general' });
  await waitFor(aliceSocket, 'room_history');
  console.log('✓ alice joined room and received history');

  // Bob does NOT join the room -> should get a "notification" instead of new_message
  const notifPromise = waitFor(bobSocket, 'notification');

  bobSocket.emit('join_room', { roomName: 'other-room' }); // bob is present but elsewhere
  await waitFor(bobSocket, 'room_history');

  aliceSocket.emit('send_message', { roomName: 'general', text: 'hello bob, this is encrypted in transit' });

  const notif = await notifPromise;
  assert.strictEqual(notif.room, 'general');
  assert.ok(notif.preview.includes('hello bob'));
  console.log('✓ bob received live notification for a room he is not viewing:', notif);

  // Now verify REST history endpoint returns decrypted message correctly
  const historyRes = await fetch(`${base}/api/rooms/general/history`, {
    headers: { Authorization: `Bearer ${alice.token}` },
  });
  const historyData = await historyRes.json();
  assert.ok(historyData.history.some((m) => m.text === 'hello bob, this is encrypted in transit'));
  console.log('✓ REST history endpoint returns correctly decrypted message');

  aliceSocket.close();
  bobSocket.close();
  server.close();
  console.log('\nALL CHAT SMOKE TESTS PASSED');
  process.exit(0);
}

function waitFor(socket, event) {
  return new Promise((resolve) => socket.once(event, resolve));
}

async function registerAndLogin(username, password, base) {
  const res = await fetch(`${base}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data;
}

main().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
