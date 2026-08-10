# Distributed Real-Time Chat Application

A scalable real-time messaging platform built with **Node.js**, **Socket.IO (WebSockets)**, and **Express**, featuring JWT authentication, AES-256-GCM encrypted message payloads, live cross-tab notifications, and concurrent multi-device session handling.

## Features

- **Real-time messaging** over WebSockets with room-based pub/sub (Socket.IO)
- **JWT authentication** for both REST endpoints and the WebSocket handshake
- **Encrypted communication** — messages are encrypted at rest with AES-256-GCM before storage/broadcast
- **Live notifications** — users connected but viewing a different room still get pinged in real time
- **Concurrent session handling** — the same user can be connected from multiple devices/tabs without presence flickering
- **Pluggable persistence** — ships with a zero-setup in-memory store; drop-in Mongoose schemas (`models/schemas.js`) are included for production MongoDB deployments

## Tech Stack

Node.js · Express · Socket.IO · JWT · bcrypt · MongoDB (optional, via Mongoose)

## Getting Started

```bash
npm install
cp .env.example .env   # fill in real secrets before deploying
npm start               # server runs on http://localhost:4000
```

Open `http://localhost:4000` in two different browser tabs to try it out — register two accounts, join the same room, and chat in real time.

## Running Tests

An end-to-end smoke test spins up the real server, connects two authenticated WebSocket clients, and verifies messaging, notifications, and REST history all work correctly:

```bash
npm test
```

## API

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/register` | Create an account, returns a JWT |
| POST | `/api/login` | Authenticate, returns a JWT |
| GET | `/api/rooms/:name/history` | Fetch decrypted message history (auth required) |

### WebSocket events

| Direction | Event | Payload |
|---|---|---|
| client → server | `join_room` | `{ roomName }` |
| client → server | `send_message` | `{ roomName, text }` |
| client → server | `leave_room` | `{ roomName }` |
| server → client | `room_history` | `{ room, history[] }` |
| server → client | `new_message` | `{ id, senderId, senderUsername, text, createdAt }` |
| server → client | `notification` | `{ room, from, preview }` |
| server → client | `presence` | `{ userId, username, status }` |

## Moving to Production MongoDB

Swap `require('./store')` in `server.js` for a thin adapter built on `models/schemas.js`, set `MONGO_URI` in `.env`, and connect via Mongoose at startup. The function signatures in `store.js` were kept deliberately identical to the Mongoose model calls to make this a drop-in swap.

## Architecture Notes

- Passwords are hashed with bcrypt (cost factor 10), never stored in plaintext.
- Message ciphertext uses AES-256-GCM with a random 12-byte IV per message and an auth tag to detect tampering.
- Presence and notification routing are tracked in-memory per Socket.IO server instance; for true horizontal scaling across multiple server instances, swap in the [Socket.IO Redis adapter](https://socket.io/docs/v4/redis-adapter/) so events fan out across nodes.

## License

MIT © Ryan Joshua George — see [LICENSE](LICENSE) for details.
