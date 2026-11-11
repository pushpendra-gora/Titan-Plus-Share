const { app, BrowserWindow, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const { fork } = require('child_process');
const http = require('http');

let mainWindow = null;
let serverProcess = null;
let tray = null;
const SERVER_PORT = 51733;

function startBackendServer() {
  const serverScript = path.join(__dirname, '..', 'server', 'server.js');
  console.log('Starting internal Titan Plus Share server from:', serverScript);

  serverProcess = fork(serverScript, [], {
    env: { ...process.env, PORT: SERVER_PORT.toString() },
    stdio: 'inherit'
  });

  serverProcess.on('error', (err) => {
    console.error('Failed to start backend server:', err);
  });
}

function waitForServer(callback, retries = 20) {
  if (retries <= 0) return callback(new Error('Server start timed out'));
  http.get(`http://127.0.0.1:${SERVER_PORT}/api/status`, (res) => {
    if (res.statusCode === 200) callback(null);
    else setTimeout(() => waitForServer(callback, retries - 1), 300);
  }).on('error', () => {
    setTimeout(() => waitForServer(callback, retries - 1), 300);
  });
}

function createWindow() {
  const iconPath = path.join(__dirname, '..', 'assets', 'logo.png');

  mainWindow = new BrowserWindow({
    width: 1060,
    height: 720,
    minWidth: 800,
    minHeight: 560,
    title: 'Titan Plus Share',
    icon: iconPath,
    frame: true,
    autoHideMenuBar: true,
    backgroundColor: '#f8f9fe',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadURL(`http://localhost:${SERVER_PORT}`);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('close', (event) => {
    // Keep server running in tray if desired, or quit
    if (!app.isQuitting) {
      // Allow standard close
    }
  });
}

app.whenReady().then(() => {
  startBackendServer();
  waitForServer((err) => {
    if (err) {
      console.error('Server wait error:', err);
    }
    createWindow();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (serverProcess) {
    serverProcess.kill();
  }
  app.quit();
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (serverProcess) {
    serverProcess.kill();
  }
});

