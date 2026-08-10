/**
 * Mongoose schemas for production deployments backed by real MongoDB.
 * Not loaded by default (see store.js) so the project runs with zero
 * external dependencies out of the box -- wire these up by setting
 * MONGO_URI in .env and requiring this file from server.js instead
 * of store.js.
 */
const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, index: true },
  passwordHash: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

const RoomSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  createdAt: { type: Date, default: Date.now },
});

const MessageSchema = new mongoose.Schema({
  roomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true, index: true },
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  ciphertext: { type: String, required: true }, // AES-256-GCM encrypted payload
  createdAt: { type: Date, default: Date.now, index: true },
});

module.exports = {
  User: mongoose.model('User', UserSchema),
  Room: mongoose.model('Room', RoomSchema),
  Message: mongoose.model('Message', MessageSchema),
};
