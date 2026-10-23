import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname } from "node:path";

const root = resolve(import.meta.dirname, "..");
const allowed =
  /^(index\.html|admin\.html|account\.html|create\/index\.html|admin\/submissions\/index\.html|favicon\.svg|firebase-config\.js|(?:css|js|data)\/[a-zA-Z0-9_./-]+)$/;
const types = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
};
const portIndex = process.argv.indexOf("--port");
const hostIndex = process.argv.indexOf("--host");
const port = Number(portIndex >= 0 ? process.argv[portIndex + 1] : process.env.PORT || 3000);
const host = hostIndex >= 0 ? process.argv[hostIndex + 1] : "127.0.0.1";
createServer(async (request, response) => {
  try {
    if (!["GET", "HEAD"].includes(request.method)) {
      response.writeHead(405);
      response.end();
      return;
    }
    let path =
      decodeURIComponent(new URL(request.url, "http://localhost").pathname).replace(/^\/+/, "") ||
      "index.html";
    if (["create", "admin/submissions"].includes(path)) {
      response.writeHead(302, { Location: `/${path}/` });
      response.end();
      return;
    }
    if (path.endsWith("/")) path += "index.html";
    const file = resolve(root, path);
    if (
      !allowed.test(path) ||
      path.split("/").some((part) => part === "." || part === "..") ||
      !file.startsWith(root + "/") ||
      !(await stat(file)).isFile()
    )
      throw new Error();
    response.writeHead(200, {
      "Content-Type": `${types[extname(file)] || "application/octet-stream"}; charset=utf-8`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(request.method === "HEAD" ? undefined : await readFile(file));
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}).listen(port, host, () =>
  process.stdout.write(
    `Daily Sports Games: http://localhost:${port}\nOwner desk: http://localhost:${port}/admin.html\n`,
  ),
);
