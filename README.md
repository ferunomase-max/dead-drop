# Dead Drop — Online Multiplayer Prototype

This is the real multiplayer version of the prototype.

## What it includes

- 3–5 players per room
- Shareable room code
- Host-controlled start
- Server-authoritative role assignment
- One secret Wiretapper
- Spies receive a private rendezvous location
- Real-time group chat using Socket.IO
- Wiretapper sees location-related words glitched
- 120-second round timer
- Wiretapper can make a final location guess
- Results screen and replay

## Run it on your computer

1. Install Node.js 18+.
2. Open a terminal in this folder.
3. Run:

   npm install
   npm start

4. Open http://localhost:3000 in your browser.
5. For testing on one computer, open several browser windows and use different codenames.

## Put it on the internet

A simple deployment target is any Node.js host that supports WebSockets. Upload this project, run `npm install`, and use:

npm start

The host should provide the PORT environment variable; server.js already uses it.

## Important production upgrades

Before a public launch, add:
- persistent room cleanup/expiry
- reconnect handling
- rate limiting and chat moderation
- server-side validation of every game action
- HTTPS/WSS (normally supplied by the host)
- stronger room IDs
- abuse reporting
- a proper mobile UI
- persistent game analytics only if desired
- optional accounts/matchmaking

The current prototype keeps room state in server memory, so restarting the server ends active games. That is intentional for a first playable version.
