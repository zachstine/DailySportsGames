import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname } from "node:path";

const root = resolve(import.meta.dirname, "..");
const allowed = /^(index\.html|admin\.html|favicon\.svg|firebase-config\.js|(?:css|js|data)\/[a-zA-Z0-9_./-]+)$/;
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml" };
const port = 3000;
createServer(async (request, response) => {
  try {
    if (!["GET", "HEAD"].includes(request.method)) { response.writeHead(405); response.end(); return; }
    const path = decodeURIComponent(new URL(request.url, "http://localhost").pathname).replace(/^\/+/, "") || "index.html";
    const file = resolve(root, path);
    if (!allowed.test(path) || path.split("/").some(part => part === "." || part === "..") || !file.startsWith(root + "/") || !(await stat(file)).isFile()) throw new Error();
    response.writeHead(200, { "Content-Type": `${types[extname(file)] || "application/octet-stream"}; charset=utf-8`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    response.end(request.method === "HEAD" ? undefined : await readFile(file));
  } catch { response.writeHead(404); response.end("Not found"); }
}).listen(port, "127.0.0.1", () => process.stdout.write(`Daily Sports Games: http://localhost:${port}\nOwner desk: http://localhost:${port}/admin.html\n`));
