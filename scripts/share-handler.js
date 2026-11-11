const http = require('http');
const { exec, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const filePath = process.argv[2];
if (!filePath) {
  process.exit(1);
}

const SERVER_URL = 'http://127.0.0.1:51733';
const rootDir = path.join(__dirname, '..');

function isServerRunning(cb) {
  const req = http.get(`${SERVER_URL}/api/status`, (res) => {
    cb(res.statusCode === 200);
  });
  req.on('error', () => cb(false));
  req.setTimeout(1000, () => {
    req.destroy();
    cb(false);
  });
}

function startServer(cb) {
  const serverJs = path.join(rootDir, 'server', 'server.js');
  const child = spawn('node', [serverJs], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  });
  child.unref();
  setTimeout(cb, 1200);
}

function sendShare(cb) {
  const data = JSON.stringify({ filePath });
  const req = http.request(`${SERVER_URL}/api/cli/share`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data)
    }
  }, (res) => {
    cb();
  });
  req.on('error', (e) => {
    cb();
  });
  req.write(data);
  req.end();
}

function openApp() {
  exec(`start ${SERVER_URL}`);
}

isServerRunning((running) => {
  if (!running) {
    startServer(() => {
      sendShare(() => {
        openApp();
      });
    });
  } else {
    sendShare(() => {
      openApp();
    });
  }
});

