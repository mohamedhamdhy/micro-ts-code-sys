const chokidar = require("chokidar");
const { Server: SocketServer } = require("socket.io");
const http = require("http");

const reloadServer = http.createServer();
const reloadIO = new SocketServer(reloadServer, { cors: { origin: "*" } });

reloadServer.listen(3001, () => console.log("👁  Watcher on ws://localhost:3001"));

chokidar.watch("public/", { persistent: true, ignoreInitial: true })
    .on("change", (f: string) => { console.log(`♻  ${f}`); reloadIO.emit("reload"); })
    .on("add", (f: string) => { console.log(`➕  ${f}`); reloadIO.emit("reload"); });

console.log("📂 Watching public/...");