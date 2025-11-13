import "dotenv/config";
import { Server, Socket } from "socket.io";

// define a type for the payload from Quill
interface CodeDelta {
  ops: unknown[];
}

const CORS_ORIGIN = process.env.WEBSOCKET_SERVER_CORS;
console.log("My CORS Origin:", CORS_ORIGIN);

const io = new Server(3001, {
  cors: {
    origin: process.env.WEBSOCKET_SERVER_CORS,
    methods: ["GET", "POST"],
  },
});

// map to store all active termination timers
const roomTimers = new Map<string, NodeJS.Timeout>();
const completedSessions = new Set<string>();
const SESSION_TIMEOUT_MS = 10000;

// define function to check room state
function checkRoomState(sessionId: string) {
  if (completedSessions.has(sessionId)) {
    // if the room is now empty, clean up the Set
    const room = io.sockets.adapter.rooms.get(sessionId);
    const roomSize = room ? room.size : 0;
    if (roomSize === 0) {
      completedSessions.delete(sessionId);
    }
    return;
  }
  const room = io.sockets.adapter.rooms.get(sessionId);
  const roomSize = room ? room.size : 0;

  const existingTimer = roomTimers.get(sessionId);

  if (roomSize === 1) {
    // room has one person
    // start a timer if not already running
    if (!existingTimer) {
      console.log(
        `[server] Starting ${
          SESSION_TIMEOUT_MS / 1000
        }s timer for room ${sessionId}`
      );

      const timer = setTimeout(() => {
        // after 15s -> check again.
        const currentRoom = io.sockets.adapter.rooms.get(sessionId);
        const currentSize = currentRoom ? currentRoom.size : 0;

        if (currentSize === 1) {
          console.log(`[server] Terminating room ${sessionId}`);
          // emit to the room, only one person is in it
          io.to(sessionId).emit("terminate-session");
        }

        // timer alrd finish
        // remove it from the map
        roomTimers.delete(sessionId);
      }, SESSION_TIMEOUT_MS);

      roomTimers.set(sessionId, timer);
    }
  } else {
    // room has 0 or 2+ people
    // clear timer
    if (existingTimer) {
      console.log(
        `[server] Clearing timer for room ${sessionId} (size: ${roomSize})`
      );
      clearTimeout(existingTimer);
      roomTimers.delete(sessionId);
    }
  }
}

io.on("connection", (socket: Socket) => {
  let currentSessionId: string | null = null;

  console.log(`[socket] connected: ${socket.id}`);

  // listen for the client's request to join a room
  socket.on("join-session", (sessionId: number) => {
    const room = String(sessionId);
    socket.join(room);
    currentSessionId = String(sessionId);
    console.log(`[socket] ${socket.id} joined room ${room}`);

    const currentRoom = io.sockets.adapter.rooms.get(room);
    const numClients = currentRoom ? currentRoom.size : 0;

    if (numClients > 1) {
      // this socket (socket.id) is the new client
      // Ask OTHERS to send their code
      // pass socket's ID so others know who to send to
      console.log(`[server] Requesting full code for new client ${socket.id}`);
      socket.to(room).emit("get-full-code", socket.id);
    }

    // emit to partner that user connected
    // find the room this socket is in but must not be socket id
    const curRoom = Array.from(socket.rooms).find((r) => r !== socket.id);
    if (curRoom) {
      // broadcast change only to respective room
      socket.to(curRoom).emit("partner-connect");
    } else {
      console.warn(`error: no room found for socket ${socket.id}`);
    }

    // check room state

    checkRoomState(String(sessionId));
  });

  // listen for code submission
  socket.on("submit-code", async (sessionId: string, code: string) => {
    // mark session as completed
    // to prevent race condition
    completedSessions.add(sessionId);
    // clear timer
    const existingTimer = roomTimers.get(sessionId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      roomTimers.delete(sessionId);
    }

    // complete session
    io.to(sessionId).emit("complete-session");

    // submit session
    // i.e. create submission + mark session as completed
    try {
      // 2. Use the FULL, absolute URL
      await fetch(
        `${process.env.WEBSOCKET_SERVER_CORS}/api/v1/collaboration?type=submitsession`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ session_id: sessionId, code_solution: code }),
        }
      );

      // log return result
    } catch (error) {
      console.error("Error submitting session:", error);
    }
    // log return result
    console.log("submitting code from websocket server");
  });

  // listen for code changes
  socket.on("send-code", (delta: CodeDelta) => {
    // find the room this socket is in but must not be socket id
    const room = Array.from(socket.rooms).find((r) => r !== socket.id);

    if (room) {
      // broadcast change only to respective room
      socket.to(room).emit("receive-code", delta);
    } else {
      console.warn(`[socket] ${socket.id} sent code but is not in a room.`);
    }
  });

  socket.on(
    "send-full-code",
    ({ code, targetSocketId }: { code: CodeDelta; targetSocketId: string }) => {
      // send the code to the socket that requested it
      console.log(`[server] Relaying full code to ${targetSocketId}`);
      io.to(targetSocketId).emit("receive-full-code", code);
    }
  );

  socket.on("disconnect", () => {
    if (currentSessionId && !completedSessions.has(currentSessionId)) {
      // send partner disconnect
      io.to(currentSessionId).emit("partner-disconnect");
      // check room state after user disconnect
      checkRoomState(currentSessionId);
    }
  });
});
