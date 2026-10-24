// The connection to the multiplayer game server (server/index.js), at the
// address the game was loaded from: in development the Vite dev server
// passes it through (see vite.config.js). Socket.IO is only loaded for
// multiplayer, so single-player never downloads it.
//
// connect() resolves once the server has said hello ({ welcome, id, send,
// on, close }), or rejects if no server answers within `timeout` ms. It
// keeps trying to reconnect after that, and the server says hello again
// each time.
export async function connect(timeout = 6000) {
  const { io } = await import('socket.io-client');
  const socket = io({ timeout, reconnectionDelayMax: 4000 });

  // A message that comes before anything listens for it (the island is
  // still being generated) waits for its listener: the latest of each kind.
  const listened = new Set(['welcome']), waiting = new Map();
  socket.onAny((type, data) => { if (!listened.has(type)) waiting.set(type, data); });

  const welcome = await new Promise((resolve, reject) => {
    const fail = (e) => {
      clearTimeout(timer);
      socket.close();
      reject(e);
    };
    const timer = setTimeout(() => fail(new Error('No answer from the game server')), timeout);
    socket.once('connect_error', fail);
    socket.once('welcome', (hello) => {
      clearTimeout(timer);
      socket.off('connect_error', fail);
      resolve(hello);
    });
  });

  return {
    welcome,
    get id() { return socket.id; },
    get connected() { return socket.connected; },
    // volatile: fine to drop if the connection is busy (where you are, 20
    // times a second), rather than queue up.
    send(type, data, volatile = false) { (volatile ? socket.volatile : socket).emit(type, data); },
    // Also takes Socket.IO's own 'connect' and 'disconnect'.
    on(type, handler) {
      listened.add(type);
      socket.on(type, handler);
      if (waiting.has(type)) {
        const data = waiting.get(type);
        waiting.delete(type);
        handler(data);
      }
    },
    close() { socket.close(); },
  };
}
