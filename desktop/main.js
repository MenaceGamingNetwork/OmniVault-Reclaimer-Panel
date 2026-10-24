'use strict';

const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

app.setName('OmniVault Reclaimer Control');
app.setAppUserModelId('com.menacegamingnetwork.omnivaultcontrol');

const connectionsFile = path.join(app.getPath('userData'), 'connections.json');
const managerFile = path.join(__dirname, 'connect.html');
const managerUrl = pathToFileURL(managerFile).href;
const fingerprintPattern = /^[a-f\d]{64}$/i;
let mainWindow;
let activeConnection = null;

function normalizeFingerprint(value) {
  return String(value || '').replace(/[^a-f\d]/gi, '').toLowerCase();
}

function validateConnection(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Connection settings must be an object.');
  }
  const label = typeof input.label === 'string' ? input.label.trim() : '';
  if (!label || label.length > 64) throw new Error('Server name must be 1-64 characters.');

  let address;
  try {
    address = new URL(input.serverOrigin);
  } catch {
    throw new Error('Enter a valid HTTPS server address.');
  }
  if (
    address.protocol !== 'https:' ||
    address.username ||
    address.password ||
    address.pathname !== '/' ||
    address.search ||
    address.hash
  ) {
    throw new Error('Use the server’s HTTPS origin only, such as https://host.example:8788.');
  }

  const fingerprint = normalizeFingerprint(input.certificateFingerprint);
  if (!fingerprintPattern.test(fingerprint)) {
    throw new Error('Enter the server’s full SHA-256 certificate fingerprint.');
  }
  return {
    id: typeof input.id === 'string' ? input.id : crypto.randomUUID(),
    label,
    serverOrigin: address.origin,
    certificateFingerprint: fingerprint,
  };
}

function readConnections() {
  if (!fs.existsSync(connectionsFile)) return [];
  const saved = JSON.parse(fs.readFileSync(connectionsFile, 'utf8'));
  if (!Array.isArray(saved)) throw new Error('Saved server connections are invalid.');
  return saved.map(validateConnection);
}

function saveConnections(connections) {
  fs.mkdirSync(path.dirname(connectionsFile), { recursive: true });
  const tempFile = `${connectionsFile}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tempFile, `${JSON.stringify(connections, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(tempFile, connectionsFile);
  } finally {
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
  }
}

function requireManagerPage(event) {
  if (!event.senderFrame || event.senderFrame.url !== managerUrl) {
    throw new Error('Server connections can only be managed from the local connection screen.');
  }
}

ipcMain.handle('connections:list', (event) => {
  requireManagerPage(event);
  return readConnections().map(({ id, label, serverOrigin, certificateFingerprint }) => ({
    id,
    label,
    serverOrigin,
    certificateFingerprint,
  }));
});

ipcMain.handle('connections:save', (event, input) => {
  requireManagerPage(event);
  const connection = validateConnection(input);
  const existing = readConnections();
  const index = existing.findIndex((item) => item.id === connection.id || item.serverOrigin === connection.serverOrigin);
  if (index >= 0) connection.id = existing[index].id;
  const next = existing.filter((item) => item.id !== connection.id && item.serverOrigin !== connection.serverOrigin);
  next.push(connection);
  saveConnections(next);
  return connection;
});

ipcMain.handle('connections:remove', (event, id) => {
  requireManagerPage(event);
  if (typeof id !== 'string') throw new Error('Choose a saved connection.');
  const current = readConnections();
  saveConnections(current.filter((item) => item.id !== id));
  return true;
});

ipcMain.handle('connections:connect', async (event, id) => {
  requireManagerPage(event);
  const connection = readConnections().find((item) => item.id === id);
  if (!connection) throw new Error('That server is not saved.');
  activeConnection = connection;
  await mainWindow.loadURL(connection.serverOrigin);
  return true;
});

function showConnectionManager() {
  activeConnection = null;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadFile(managerFile);
  }
}

app.on('certificate-error', (event, _contents, url, _error, certificate, callback) => {
  let target;
  try {
    target = new URL(url);
  } catch {
    callback(false);
    return;
  }

  if (!activeConnection || target.origin !== activeConnection.serverOrigin) {
    callback(false);
    return;
  }

  let actualFingerprint;
  try {
    actualFingerprint = new crypto.X509Certificate(certificate.data).fingerprint256;
  } catch {
    callback(false);
    return;
  }

  const trusted = normalizeFingerprint(actualFingerprint) === activeConnection.certificateFingerprint;
  if (trusted) event.preventDefault();
  callback(trusted);
});

app.whenReady().then(async () => {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 820,
    minHeight: 600,
    title: 'OmniVault Reclaimer Control',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Servers',
      submenu: [
        {
          label: 'Manage connections',
          accelerator: 'Ctrl+Shift+S',
          click: showConnectionManager,
        },
         {
           label: 'Check for updates',
           click: () => autoUpdater.checkForUpdatesAndNotify().catch((error) => console.error(error.message)),
         },

        { role: 'quit' },
      ],
    },
  ]));

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url === managerUrl) return;
    let target;
    try {
      target = new URL(url);
    } catch {
      event.preventDefault();
      return;
    }
    if (!activeConnection || target.origin !== activeConnection.serverOrigin) event.preventDefault();
  });
  mainWindow.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error(`Could not load ${url}: ${description} (${code}).`);
  });

  await mainWindow.loadFile(managerFile);

  if (app.isPackaged) {
    autoUpdater.allowPrerelease = true;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('error', (error) => console.error(`Update check failed: ${error.message}`));
    autoUpdater.on('update-downloaded', () => {
      console.log('An update is ready and will install when the app closes.');
    });
    setTimeout(() => {
      autoUpdater.checkForUpdatesAndNotify().catch((error) => {
        console.error(`Update check failed: ${error.message}`);
      });
    }, 8000);
  }
}).catch((error) => {
  console.error(`Desktop startup failed: ${error.message}`);
});

app.on('window-all-closed', () => {
  app.quit();
});
