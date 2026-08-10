/**
 * In-memory data store used out-of-the-box so the app runs with zero setup.
 *
 * Swap this module for `store.mongo.js` (see models/) to persist to a real
 * MongoDB cluster in production -- the exported function signatures are
 * kept identical on purpose so server.js doesn't need to change.
 */
const crypto = require('crypto');

const users = new Map();      // userId -> { id, username, passwordHash }
const usernameIndex = new Map(); // username -> userId
const rooms = new Map();      // roomId -> { id, name, members:Set<userId> }
const messages = new Map();   // roomId -> [ { id, roomId, senderId, ciphertext, createdAt } ]

function createUser({ username, passwordHash }) {
  if (usernameIndex.has(username)) {
    throw new Error('Username already taken');
  }
  const id = crypto.randomUUID();
  const user = { id, username, passwordHash };
  users.set(id, user);
  usernameIndex.set(username, id);
  return user;
}

function findUserByUsername(username) {
  const id = usernameIndex.get(username);
  return id ? users.get(id) : null;
}

function findUserById(id) {
  return users.get(id) || null;
}

function getOrCreateRoom(name) {
  for (const room of rooms.values()) {
    if (room.name === name) return room;
  }
  const id = crypto.randomUUID();
  const room = { id, name, members: new Set() };
  rooms.set(id, room);
  messages.set(id, []);
  return room;
}

function addMessage(roomId, senderId, ciphertext) {
  const msg = {
    id: crypto.randomUUID(),
    roomId,
    senderId,
    ciphertext,
    createdAt: new Date().toISOString(),
  };
  if (!messages.has(roomId)) messages.set(roomId, []);
  messages.get(roomId).push(msg);
  return msg;
}

function getRecentMessages(roomId, limit = 50) {
  const list = messages.get(roomId) || [];
  return list.slice(-limit);
}

module.exports = {
  createUser,
  findUserByUsername,
  findUserById,
  getOrCreateRoom,
  addMessage,
  getRecentMessages,
};
