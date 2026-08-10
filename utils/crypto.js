const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
// In production this key should come from a secrets manager / KMS, never hardcoded.
const KEY = crypto.createHash('sha256').update(process.env.MESSAGE_SECRET || 'dev-secret-change-me').digest();

/**
 * Encrypts a plaintext message. Returns a single base64 string containing
 * iv + authTag + ciphertext so it can be stored/transmitted as one field.
 */
function encryptMessage(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

/**
 * Reverses encryptMessage.
 */
function decryptMessage(payload) {
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);
  const decipher = crypto.createDecipheriv(ALGO, KEY, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

module.exports = { encryptMessage, decryptMessage };
