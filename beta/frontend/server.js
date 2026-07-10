// Passenger wrapper for Next.js standalone output.
//
// Passenger sets PORT via the environment; Next.js standalone's own
// server.js reads process.env.PORT too — but Passenger also expects the
// process to bind to that exact port and start within its timeout window.
// This thin wrapper does nothing but start the standalone server with
// the right port, then lets Node hold the process open.
//
// If you see a 503 "no suitable worker found" it means either:
//   a) The standalone server.js isn't in apps/rip-frontend/ (check path)
//   b) PORT isn't being honoured — try hard-coding below for debug
//   c) The process exited early — check ~/logs/ for the Passenger error log

const { createServer } = require("http");
const { parse } = require("url");
const next = require("next");

const port = parseInt(process.env.PORT || "3000", 10);
const app = next({ dev: false, dir: __dirname });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  }).listen(port, () => {
    console.log(`> NinetyData RIP frontend ready on port ${port}`);
  });
});
