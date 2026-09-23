import express from "express";
import http from "http";
import { Server } from "socket.io";
import crypto from "crypto";

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.static("public"));

const LOCATIONS = [
  "Central Station", "Riverside Hotel", "Old Cinema", "Harbor Café",
  "Museum Square", "North Bridge", "Grand Library", "Clocktower Plaza"
];

const rooms = new Map();

function code() {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
}
function cleanName(name) {
  const s = String(name || "").trim().replace(/\s+/g, " ");
  return (s || "Agent").slice(0, 18);
}
function publicRoom(room) {
  return {
    code: room.code,
    phase: room.phase,
    players: room.players.map(p => ({ id: p.id, name: p.name, ready: p.ready })),
    maxPlayers: 5,
    minPlayers: 3,
    timeLeft: room.timeLeft
  };
}
function emitRoom(room) {
  io.to(room.code).emit("room:update", publicRoom(room));
}
function privateState(room, socketId) {
  const p = room.players.find(x => x.id === socketId);
  if (!p) return null;
  return {
    role: p.role,
    location: p.role === "Spy" ? room.location : null,
    phase: room.phase,
    timeLeft: room.timeLeft
  };
}
function resetRound(room) {
  room.phase = "playing";
  room.location = LOCATIONS[Math.floor(Math.random() * LOCATIONS.length)];
  room.timeLeft = 120;
  room.messages = [];
  const shuffled = [...room.players].sort(() => Math.random() - 0.5);
  shuffled.forEach((p, i) => {
    p.role = i === 0 ? "Wiretapper" : "Spy";
  });
}
function startTimer(room) {
  clearInterval(room.timer);
  room.timer = setInterval(() => {
    if (room.phase !== "playing") return;
    room.timeLeft -= 1;
    io.to(room.code).emit("timer", room.timeLeft);
    if (room.timeLeft <= 0) endRound(room, null);
  }, 1000);
}
function endRound(room, guess) {
  if (room.phase !== "playing") return;
  room.phase = "ended";
  clearInterval(room.timer);
  const wiretapper = room.players.find(p => p.role === "Wiretapper");
  const wiretapperWon = guess && guess === room.location;
  io.to(room.code).emit("round:end", {
    actualLocation: room.location,
    guess,
    wiretapperWon,
    wiretapperName: wiretapper?.name || "Unknown"
  });
  emitRoom(room);
}

io.on("connection", socket => {
  socket.on("room:create", ({ name }) => {
    let c;
    do c = code(); while (rooms.has(c));
    const room = {
      code: c, phase: "lobby", players: [], messages: [],
      location: null, timeLeft: 120, timer: null
    };
    rooms.set(c, room);
    room.players.push({ id: socket.id, name: cleanName(name), ready: true, role: null });
    socket.join(c);
    socket.data.room = c;
    socket.emit("room:joined", { code: c, playerId: socket.id });
    emitRoom(room);
  });

  socket.on("room:join", ({ code, name }) => {
    const c = String(code || "").trim().toUpperCase();
    const room = rooms.get(c);
    if (!room) return socket.emit("error:message", "Room not found.");
    if (room.phase !== "lobby") return socket.emit("error:message", "That game has already started.");
    if (room.players.length >= 5) return socket.emit("error:message", "That room is full.");
    room.players.push({ id: socket.id, name: cleanName(name), ready: false, role: null });
    socket.join(c);
    socket.data.room = c;
    socket.emit("room:joined", { code: c, playerId: socket.id });
    emitRoom(room);
  });

  socket.on("game:start", () => {
    const room = rooms.get(socket.data.room);
    if (!room || room.players[0]?.id !== socket.id) return;
    if (room.players.length < 3) return socket.emit("error:message", "You need at least 3 players.");
    resetRound(room);
    room.players.forEach(p => io.to(p.id).emit("game:state", privateState(room, p.id)));
    io.to(room.code).emit("chat:reset");
    io.to(room.code).emit("chat:message", {
      name: "SYSTEM",
      text: "Operation started. Keep the rendezvous secret."
    });
    emitRoom(room);
    startTimer(room);
  });

  socket.on("chat:send", ({ text }) => {
    const room = rooms.get(socket.data.room);
    if (!room || room.phase !== "playing") return;
    const sender = room.players.find(p => p.id === socket.id);
    const clean = String(text || "").trim().slice(0, 240);
    if (!sender || !clean) return;
    const msg = { name: sender.name, text: clean };
    room.messages.push(msg);
    room.messages = room.messages.slice(-100);

    for (const p of room.players) {
      let visible = clean;
      if (p.role === "Wiretapper") {
        for (const word of room.location.split(/\s+/)) {
          if (word.length >= 4) {
            const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            visible = visible.replace(new RegExp(escaped, "gi"), "████");
          }
        }
      }
      io.to(p.id).emit("chat:message", { ...msg, text: visible });
    }
  });

  socket.on("game:guess", ({ location }) => {
    const room = rooms.get(socket.data.room);
    if (!room || room.phase !== "playing") return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.role !== "Wiretapper") return;
    if (!LOCATIONS.includes(location)) return;
    endRound(room, location);
  });

  socket.on("game:again", () => {
    const room = rooms.get(socket.data.room);
    if (!room || room.phase !== "ended" || room.players[0]?.id !== socket.id) return;
    resetRound(room);
    room.players.forEach(p => io.to(p.id).emit("game:state", privateState(room, p.id)));
    io.to(room.code).emit("chat:reset");
    io.to(room.code).emit("chat:message", { name: "SYSTEM", text: "New operation started." });
    emitRoom(room);
    startTimer(room);
  });

  socket.on("disconnect", () => {
    const c = socket.data.room;
    const room = rooms.get(c);
    if (!room) return;
    room.players = room.players.filter(p => p.id !== socket.id);
    if (!room.players.length) {
      clearInterval(room.timer);
      rooms.delete(c);
      return;
    }
    if (room.phase !== "lobby") {
      room.phase = "ended";
      clearInterval(room.timer);
      io.to(room.code).emit("round:end", {
        actualLocation: room.location,
        guess: null,
        wiretapperWon: false,
        disconnected: true,
        message: "A player disconnected, so the round was ended."
      });
    }
    emitRoom(room);
  });
});

server.listen(PORT, () => console.log(`Dead Drop listening on port ${PORT}`));
