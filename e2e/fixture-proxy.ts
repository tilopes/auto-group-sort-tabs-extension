// A local HTTP(S) proxy that answers every request with a small page, so the browser can open
// real-looking URLs (https://github.com/..., http://localhost:3000/...) without any network.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";

const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

function page(request: IncomingMessage, response: ServerResponse, origin: string) {
  const url = request.url?.startsWith("/") ? origin + request.url : (request.url ?? origin);
  // Chromium opens a login tab when its connectivity check does not get a 204.
  if (url.endsWith("/favicon.ico") || url.endsWith("/generate_204")) {
    response.writeHead(204).end();
    return;
  }
  response.writeHead(200, { "content-type": "text/html" });
  response.end(`<!doctype html><title>${escapeHtml(url)}</title><p>${escapeHtml(url)}</p>`);
}

/** Self-signed certificate; the browser is started with certificate errors ignored. */
function selfSigned() {
  const dir = mkdtempSync(join(tmpdir(), "ast-cert-"));
  try {
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-subj",
        "/CN=fixture",
        "-days",
        "1",
      ].concat(["-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem")]),
      { stdio: "ignore" },
    );
    return { key: readFileSync(join(dir, "key.pem")), cert: readFileSync(join(dir, "cert.pem")) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function startFixtureProxy() {
  const https = createHttpsServer(selfSigned(), (request, response) =>
    page(request, response, `https://${request.headers.host ?? "fixture"}`),
  );
  const proxy = createHttpServer((request, response) => page(request, response, "http://fixture"));
  const tunnels = new Set<Duplex>();
  // HTTPS through a proxy arrives as CONNECT; hand the tunnel to the HTTPS server.
  proxy.on("connect", (_request, socket) => {
    tunnels.add(socket);
    socket.on("close", () => tunnels.delete(socket));
    socket.on("error", () => {});
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    https.emit("connection", socket);
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`,
    async close() {
      tunnels.forEach((socket) => socket.destroy());
      proxy.closeAllConnections();
      https.closeAllConnections();
      await Promise.all([
        new Promise((resolve) => proxy.close(resolve)),
        new Promise((resolve) => https.close(resolve)),
      ]);
    },
  };
}
