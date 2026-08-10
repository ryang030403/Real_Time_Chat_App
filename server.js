require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Server } = require('socket.io');
const path = require('path');

const store = require('./store');
const { encryptMessage, decryptMessage } = require('./utils/crypto');

const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret-change-me';

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// ---------- REST: auth ----------

app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password || password.length < 6) {
      return res.status(400).json({ error: 'username and password (min 6 chars) required' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const user = store.createUser({ username, passwordHash });
    const token = jwt.sign({ sub: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, user: { id: user.id, username: user.username } });
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const user = store.findUserByUsername(username);
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign({ sub: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, username: user.username } });
});

app.get('/api/rooms/:name/history', authenticateHttp, (req, res) => {
  const room = store.getOrCreateRoom(req.params.name);
  const history = store.getRecentMessages(room.id).map((m) => ({
    id: m.id,
    senderId: m.senderId,
    text: decryptMessage(m.ciphertext),
    createdAt: m.createdAt,
  }));
  res.json({ room: room.name, history });
});

function authenticateHttp(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ---------- WebSocket: real-time messaging ----------

// userId -> Set of socket ids, enabling concurrent multi-device sessions
const activeSessions = new Map();
// userId -> Set of room names currently joined (for offline-notification routing)
const presenceByRoom = new Map(); // roomName -> Set(userId)

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Authentication required'));
  try {
    socket.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    next(new Error('Invalid or expired token'));
  }
});

io.on('connection', (socket) => {
  const userId = socket.user.sub;

  if (!activeSessions.has(userId)) activeSessions.set(userId, new Set());
  activeSessions.get(userId).add(socket.id);

  socket.on('join_room', ({ roomName }) => {
    const room = store.getOrCreateRoom(roomName);
    socket.join(room.name);

    if (!presenceByRoom.has(room.name)) presenceByRoom.set(room.name, new Set());
    presenceByRoom.get(room.name).add(userId);

    const history = store.getRecentMessages(room.id).map((m) => ({
      id: m.id,
      senderId: m.senderId,
      text: decryptMessage(m.ciphertext),
      createdAt: m.createdAt,
    }));

    socket.emit('room_history', { room: room.name, history });
    socket.to(room.name).emit('presence', { userId, username: socket.user.username, status: 'online' });
  });

  socket.on('send_message', ({ roomName, text }) => {
    if (!text || !text.trim()) return;
    const room = store.getOrCreateRoom(roomName);
    const ciphertext = encryptMessage(text);
    const saved = store.addMessage(room.id, userId, ciphertext);

    const payload = {
      id: saved.id,
      roomId: room.id,
      senderId: userId,
      senderUsername: socket.user.username,
      text, // server decrypts before broadcasting to live room members
      createdAt: saved.createdAt,
    };

    io.to(room.name).emit('new_message', payload);

    // Live notification: ping any other currently-connected user whose
    // sockets are NOT subscribed to this room (e.g. active on another tab
    // or viewing a different room), so they still hear about new activity.
    for (const [memberId, sockets] of activeSessions.entries()) {
      if (memberId === userId) continue;
      for (const sockId of sockets) {
        const memberSocket = io.sockets.sockets.get(sockId);
        if (memberSocket && !memberSocket.rooms.has(room.name)) {
          memberSocket.emit('notification', {
            room: room.name,
            from: socket.user.username,
            preview: text.slice(0, 80),
          });
        }
      }
    }
  });

  socket.on('leave_room', ({ roomName }) => {
    socket.leave(roomName);
    socket.to(roomName).emit('presence', { userId, username: socket.user.username, status: 'offline' });
  });

  socket.on('disconnect', () => {
    const sockets = activeSessions.get(userId);
    if (sockets) {
      sockets.delete(socket.id);
      // Only broadcast "offline" once the user's LAST session disconnects,
      // so multi-device / multi-tab sessions don't falsely flicker presence.
      if (sockets.size === 0) {
        activeSessions.delete(userId);
        for (const [roomName, members] of presenceByRoom.entries()) {
          if (members.has(userId)) {
            members.delete(userId);
            io.to(roomName).emit('presence', { userId, username: socket.user.username, status: 'offline' });
          }
        }
      }
    }
  });
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`Chat server listening on :${PORT}`));
}

module.exports = { app, server, io };
