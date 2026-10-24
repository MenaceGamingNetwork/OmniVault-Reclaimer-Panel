'use strict';

const { execFile } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const { promisify } = require('node:util');
const { URL } = require('node:url');

const ROOT = path.resolve(process.env.PANEL_SERVER_ROOT || path.join(__dirname, '..'));
const EXECUTABLE = path.resolve(ROOT, process.env.PANEL_RECLAIMER_EXE || 'project-reclaimer-dedicated-v0.9.23.exe');
const CONFIG = path.resolve(ROOT, process.env.PANEL_CONFIG || 'dedicated.toml');
const PUBLIC = path.join(__dirname, 'public');
const DATA_DIRECTORY = path.resolve(ROOT, process.env.PANEL_DATA_DIRECTORY || 'data');
const HOST = '127.0.0.1';
const PORT = Number(process.env.PANEL_PORT || 8787);
const REMOTE_HOST = process.env.PANEL_REMOTE_HOST || '';
const REMOTE_PORT = Number(process.env.PANEL_REMOTE_PORT || 8788);
const PUBLIC_HOSTS = (process.env.PANEL_PUBLIC_HOSTS || process.env.PANEL_PUBLIC_HOST || '')
  .split(',')
  .map((host) => host.trim().toLowerCase())
  .filter(Boolean);
const TLS_PFX = process.env.PANEL_TLS_PFX || '';
const AUTH_FILE = path.join(DATA_DIRECTORY, 'panel-auth.json');
const SESSION_COOKIE = 'reclaimer_panel_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;
const scrypt = promisify(crypto.scrypt);
const sessions = new Map();
const loginAttempts = new Map();
const ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost', ...PUBLIC_HOSTS]);
const MAP_WEAPON_SETS = new Map([
  [0, 'Default'],
  [1, 'Assault rifles'],
  [2, 'Dual wield'],
  [3, 'Hammers'],
  [4, 'Lasers'],
  [5, 'Rockets'],
  [6, 'Shotguns'],
  [7, 'Sniper rifles'],
  [8, 'Swords'],
  [9, 'No power weapons'],
  [10, 'No snipers'],
  [11, 'No weapons'],
  [12, 'Random'],
  [13, 'ODST weapons'],
]);
const MAP_VEHICLE_SETS = new Map([
  [0, 'Default'],
  [1, 'None'],
  [2, 'Mongooses'],
  [3, 'Light ground'],
  [4, 'Tanks'],
  [5, 'Aircraft'],
  [6, 'No light ground'],
  [7, 'No tanks'],
  [8, 'No aircraft'],
  [9, 'All'],
]);
const MODE_DIRECTORY = path.join(ROOT, 'content', 'Game Modes');

function tomlString(block, key) {
  const match = block.match(new RegExp(`^\\s*${key}\\s*=\\s*("(?:\\\\.|[^"\\\\])*")`, 'm'));
  return match ? JSON.parse(match[1]) : undefined;
}

function loadServers() {
  const text = fs.readFileSync(CONFIG, 'utf8');
  const blocks = text.split(/^\s*\[\[server\]\]\s*$/m).slice(1);
  const servers = [];

  for (const block of blocks) {
    const name = tomlString(block, 'name');
    const portMatch = block.match(/^\s*port\s*=\s*(\d+)\s*$/m);
    const enabledMatch = block.match(/^\s*enabled\s*=\s*(true|false)\s*$/mi);
    if (!name || !portMatch || (enabledMatch && enabledMatch[1].toLowerCase() === 'false')) continue;
    servers.push({ name, port: Number(portMatch[1]), game: tomlString(block, 'game') });
  }

  if (servers.length === 0) throw new Error('No enabled server entries were found in dedicated.toml.');
  if (new Set(servers.map((server) => server.name)).size !== servers.length) {
    throw new Error('Server names in dedicated.toml must be unique for RCON selection.');
  }
  return servers;
}

function findConfiguredServer(name) {
  const server = loadServers().find((entry) => entry.name === name);
  if (!server) throw Object.assign(new Error('Choose a server from dedicated.toml.'), { status: 400 });
  return server;
}

function findModeFiles(directory, gameName, matches = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      findModeFiles(filePath, gameName, matches);
    } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.json') {
      const mode = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (typeof mode.name === 'string' && mode.name.toLowerCase() === gameName.toLowerCase()) {
        matches.push({ filePath, mode });
      }
    }
  }
  return matches;
}

function modeForServer(server) {
  if (!server.game) return null;
  const matches = findModeFiles(MODE_DIRECTORY, server.game);
  if (matches.length !== 1) return null;
  const [match] = matches;
  if (!match.mode.options || typeof match.mode.options !== 'object' || Array.isArray(match.mode.options)) {
    throw new Error(`The "${server.game}" preset does not contain game options.`);
  }
  return match;
}

function readGameOptions(server) {
  if (!server.game) {
    return { available: false, reason: 'This server uses a playlist; select a server with one configured custom game.' };
  }
  const match = modeForServer(server);
  if (!match) {
    return { available: false, reason: `Could not find one unique custom preset for "${server.game}".` };
  }
  return {
    available: true,
    game: server.game,
    mapVehicles: match.mode.options['map.vehicles'] ?? 0,
    mapWeapons: match.mode.options['map.weapons'] ?? 0,
  };
}

function runRcon(server, command) {
  return new Promise((resolve, reject) => {
    execFile(
      EXECUTABLE,
      ['dedicated', 'rcon', '--server', server, ...command],
      { cwd: ROOT, timeout: 20000, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error((stderr || stdout || error.message).trim()));
          return;
        }
        resolve((stdout || '').trim());
      }
    );
  });
}

function validateModeFile(filePath) {
  return new Promise((resolve, reject) => {
    execFile(
      EXECUTABLE,
      ['mode-check', filePath],
      { cwd: ROOT, timeout: 30000, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error((stderr || stdout || error.message).trim()));
          return;
        }
        resolve((stdout || '').trim());
      }
    );
  });
}

async function saveGameOptions(server, mapVehicles, mapWeapons) {
  if (!MAP_VEHICLE_SETS.has(mapVehicles) || !MAP_WEAPON_SETS.has(mapWeapons)) {
    throw Object.assign(new Error('Choose a supported map vehicle and weapon set.'), { status: 400 });
  }
  const match = modeForServer(server);
  if (!match) {
    throw Object.assign(new Error(`Could not find one unique custom preset for "${server.game || 'this server'}".`), { status: 400 });
  }

  const original = fs.readFileSync(match.filePath, 'utf8');
  const mode = JSON.parse(original);
  if (mapVehicles === 0) delete mode.options['map.vehicles'];
  else mode.options['map.vehicles'] = mapVehicles;
  if (mapWeapons === 0) delete mode.options['map.weapons'];
  else mode.options['map.weapons'] = mapWeapons;

  const tempPath = path.join(
    path.dirname(match.filePath),
    `.${path.basename(match.filePath)}.${process.pid}.${Date.now()}.tmp`
  );
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(mode, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    const validation = await validateModeFile(tempPath);
    if (fs.readFileSync(match.filePath, 'utf8') !== original) {
      throw Object.assign(new Error('The preset changed while applying settings. Refresh and try again.'), { status: 409 });
    }
    fs.renameSync(tempPath, match.filePath);
    return validation;
  } finally {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }
}

function hidePlayerIdentifiers(text) {
  return text
    .replace(/\b[a-f\d]{40,}\b/gi, '[identifier hidden]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[address hidden]');
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(value));
}

function validateRequestHost(request) {
  const hostHeader = request.headers.host || '';
  let hostname;
  try {
    hostname = new URL(`${request.socket.encrypted ? 'https' : 'http'}://${hostHeader}`).hostname.toLowerCase();
  } catch {
    return false;
  }
  return ALLOWED_HOSTS.has(hostname);
}

function validateSameOrigin(request) {
  const origin = request.headers.origin;
  const hostHeader = request.headers.host;
  const protocol = request.socket.encrypted ? 'https' : 'http';
  return Boolean(origin && hostHeader && origin === `${protocol}://${hostHeader}`);
}

function isLoopback(request) {
  const address = request.socket.remoteAddress || '';
  return address === '::1' || address === '127.0.0.1' || address.startsWith('::ffff:127.');
}

function readCookie(request, name) {
  const header = request.headers.cookie || '';
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return undefined;
}

function currentSession(request) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return { token, ...session };
}

function setSessionCookie(response, request, token) {
  const secure = request.socket.encrypted ? '; Secure' : '';
  response.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}${secure}`
  );
}

function clearSessionCookie(response, request) {
  const secure = request.socket.encrypted ? '; Secure' : '';
  response.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
}

function createSession(response, request) {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrfToken = crypto.randomBytes(32).toString('base64url');
  sessions.set(token, { csrfToken, expiresAt: Date.now() + SESSION_TTL_MS });
  setSessionCookie(response, request, token);
  return csrfToken;
}

function sessionHasCsrf(request, session) {
  const provided = request.headers['x-panel-csrf'];
  if (typeof provided !== 'string') return false;
  const expectedBytes = Buffer.from(session.csrfToken);
  const providedBytes = Buffer.from(provided);
  return expectedBytes.length === providedBytes.length && crypto.timingSafeEqual(expectedBytes, providedBytes);
}

function loginRateLimit(clientAddress) {
  const now = Date.now();
  const attempts = loginAttempts.get(clientAddress);
  if (!attempts || attempts.windowEndsAt <= now) {
    loginAttempts.set(clientAddress, { count: 0, windowEndsAt: now + LOGIN_WINDOW_MS });
    return 0;
  }
  return attempts.count >= LOGIN_MAX_ATTEMPTS ? attempts.windowEndsAt - now : 0;
}

function recordLoginFailure(clientAddress) {
  const now = Date.now();
  let attempts = loginAttempts.get(clientAddress);
  if (!attempts || attempts.windowEndsAt <= now) {
    attempts = { count: 0, windowEndsAt: now + LOGIN_WINDOW_MS };
    loginAttempts.set(clientAddress, attempts);
  }
  attempts.count += 1;
}

async function derivePasswordHash(password, salt) {
  return scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

function readAuthConfig() {
  if (!fs.existsSync(AUTH_FILE)) return null;
  const config = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
  if (
    config.version !== 1 ||
    typeof config.salt !== 'string' ||
    typeof config.hash !== 'string' ||
    Buffer.from(config.salt, 'base64').length !== 16 ||
    Buffer.from(config.hash, 'base64').length !== 64
  ) {
    throw new Error('Panel authentication config is invalid; do not expose the panel until it is repaired.');
  }
  return config;
}

async function createAuthConfig(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
    throw Object.assign(new Error('Use an admin password between 12 and 128 characters.'), { status: 400 });
  }
  const salt = crypto.randomBytes(16);
  const hash = await derivePasswordHash(password, salt);
  const contents = `${JSON.stringify({
    version: 1,
    salt: salt.toString('base64'),
    hash: Buffer.from(hash).toString('base64'),
    createdAt: new Date().toISOString(),
  }, null, 2)}\n`;
  try {
    fs.writeFileSync(AUTH_FILE, contents, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw Object.assign(new Error('The admin password has already been set.'), { status: 409 });
    }
    throw error;
  }
}

async function verifyPassword(password) {
  const config = readAuthConfig();
  if (!config || typeof password !== 'string' || password.length > 128) return false;
  const expected = Buffer.from(config.hash, 'base64');
  const actual = Buffer.from(await derivePasswordHash(password, Buffer.from(config.salt, 'base64')));
  return crypto.timingSafeEqual(expected, actual);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 8192) throw Object.assign(new Error('Request body is too large.'), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('Request body must be valid JSON.'), { status: 400 });
  }
}

function textField(body, key, maxLength, optional = false) {
  const value = body[key];
  if (optional && (value === undefined || value === null || value === '')) return undefined;
  if (typeof value !== 'string') throw Object.assign(new Error(`"${key}" must be text.`), { status: 400 });
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized)) {
    throw Object.assign(new Error(`"${key}" must be 1-${maxLength} characters without control characters.`), { status: 400 });
  }
  return normalized;
}

function commandFor(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw Object.assign(new Error('Request body must be a JSON object.'), { status: 400 });
  }

  switch (body.action) {
    case 'say':
      return ['say', `[Panel] ${textField(body, 'message', 240)}`];
    case 'map':
    case 'nextmap':
    case 'load': {
      const map = textField(body, 'map', 160);
      const mode = textField(body, 'mode', 160, true);
      return [body.action, map, ...(mode ? [mode] : [])];
    }
    case 'kick': {
      const player = textField(body, 'player', 120);
      const reason = textField(body, 'reason', 240, true);
      return ['kick', player, ...(reason ? [reason] : [])];
    }
    case 'ban': {
      const player = textField(body, 'player', 120);
      const duration = body.duration === undefined || body.duration === '' ? '30m' : textField(body, 'duration', 12);
      if (!/^\d+[smhdw]$/.test(duration)) {
        throw Object.assign(new Error('Ban duration must look like 30m, 12h, 7d, or 2w.'), { status: 400 });
      }
      const reason = textField(body, 'reason', 240, true);
      return ['ban', player, duration, ...(reason ? [reason] : [])];
    }
    case 'unban':
      return ['unban', textField(body, 'player', 160)];
    case 'endround':
    case 'endgame':
      return [body.action];
    default:
      throw Object.assign(new Error('Unsupported dashboard action.'), { status: 400 });
  }
}

async function snapshot(server) {
  const [status, players] = await Promise.allSettled([
    runRcon(server.name, ['status']),
    runRcon(server.name, ['players']),
  ]);
  return {
    ...server,
    status: status.status === 'fulfilled' ? status.value : '',
    players: players.status === 'fulfilled' ? hidePlayerIdentifiers(players.value) : '',
    error: status.status === 'rejected' ? status.reason.message : null,
    playersError: players.status === 'rejected' ? players.reason.message : null,
  };
}

const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/panel.css', ['panel.css', 'text/css; charset=utf-8']],
  ['/panel.js', ['panel.js', 'text/javascript; charset=utf-8']],
]);

async function handle(request, response) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Frame-Options', 'DENY');
  if (request.socket.encrypted) {
    response.setHeader('Strict-Transport-Security', 'max-age=31536000');
  }
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
  );

  if (!validateRequestHost(request)) {
    sendJson(response, 403, { error: 'Use the local dashboard address.' });
    return;
  }

  const protocol = request.socket.encrypted ? 'https' : 'http';
  const url = new URL(request.url, `${protocol}://${request.headers.host}`);

  if (request.method === 'GET' && url.pathname === '/api/auth/state') {
    const session = currentSession(request);
    sendJson(response, 200, session
      ? { authenticated: true, csrfToken: session.csrfToken }
      : { authenticated: false, setupRequired: !readAuthConfig() });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/setup') {
    if (!validateSameOrigin(request) || !isLoopback(request)) {
      sendJson(response, 403, { error: 'Initial password setup is available only from this PC.' });
      return;
    }
    if (readAuthConfig()) {
      sendJson(response, 409, { error: 'The admin password has already been set.' });
      return;
    }
    const body = await readJson(request);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      sendJson(response, 400, { error: 'Request body must be a JSON object.' });
      return;
    }
    if (body.password !== body.confirmPassword) {
      sendJson(response, 400, { error: 'The passwords do not match.' });
      return;
    }
    await createAuthConfig(body.password);
    const csrfToken = createSession(response, request);
    sendJson(response, 201, { authenticated: true, csrfToken });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/login') {
    if (!validateSameOrigin(request)) {
      sendJson(response, 403, { error: 'Cross-origin requests are not allowed.' });
      return;
    }
    if (!readAuthConfig()) {
      sendJson(response, 409, { error: 'Set the admin password from this PC first.' });
      return;
    }
    const clientAddress = request.socket.remoteAddress || 'unknown';
    const waitMs = loginRateLimit(clientAddress);
    if (waitMs > 0) {
      response.setHeader('Retry-After', String(Math.ceil(waitMs / 1000)));
      sendJson(response, 429, { error: 'Too many login attempts. Try again later.' });
      return;
    }
    const body = await readJson(request);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      sendJson(response, 400, { error: 'Request body must be a JSON object.' });
      return;
    }
    if (!(await verifyPassword(body.password))) {
      recordLoginFailure(clientAddress);
      sendJson(response, 401, { error: 'Incorrect password.' });
      return;
    }
    loginAttempts.delete(clientAddress);
    const csrfToken = createSession(response, request);
    sendJson(response, 200, { authenticated: true, csrfToken });
    return;
  }

  const session = currentSession(request);
  if (url.pathname.startsWith('/api/')) {
    if (!session) {
      sendJson(response, 401, { error: 'Sign in to use the control panel.' });
      return;
    }
    if (
      request.method === 'POST' &&
      (!validateSameOrigin(request) || !sessionHasCsrf(request, session))
    ) {
      sendJson(response, 403, { error: 'The session is invalid or expired. Sign in again.' });
      return;
    }
  }

  if (request.method === 'POST' && url.pathname === '/api/logout') {
    sessions.delete(session.token);
    clearSessionCookie(response, request);
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/servers') {
    const servers = loadServers();
    const snapshots = await Promise.all(servers.map(snapshot));
    sendJson(response, 200, { servers: snapshots });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/catalog') {
    const server = url.searchParams.get('server');
    if (!server || !loadServers().some((entry) => entry.name === server)) {
      sendJson(response, 400, { error: 'Choose a server from dedicated.toml.' });
      return;
    }
    const [maps, modes] = await Promise.all([
      runRcon(server, ['maps']),
      runRcon(server, ['modes']),
    ]);
    sendJson(response, 200, { maps, modes });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/game-options') {
    const name = url.searchParams.get('server');
    if (!name) {
      sendJson(response, 400, { error: 'Choose a server from dedicated.toml.' });
      return;
    }
    sendJson(response, 200, readGameOptions(findConfiguredServer(name)));
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/game-options') {
    if (!validateSameOrigin(request)) {
      sendJson(response, 403, { error: 'Cross-origin requests are not allowed.' });
      return;
    }
    const body = await readJson(request);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      sendJson(response, 400, { error: 'Request body must be a JSON object.' });
      return;
    }
    if (typeof body.server !== 'string') {
      sendJson(response, 400, { error: 'Choose a server from dedicated.toml.' });
      return;
    }
    if (!Number.isInteger(body.mapVehicles) || !Number.isInteger(body.mapWeapons)) {
      sendJson(response, 400, { error: 'Vehicle and weapon sets must be whole-number selections.' });
      return;
    }
    const server = findConfiguredServer(body.server);
    const validation = await saveGameOptions(server, body.mapVehicles, body.mapWeapons);
    let reload;
    try {
      reload = await runRcon(server.name, ['reload']);
    } catch (error) {
      throw Object.assign(
        new Error(`Settings were saved and validated, but the server reload failed: ${error.message}`),
        { status: 502 }
      );
    }
    sendJson(response, 200, {
      result: `Saved and validated for ${server.game}. The server reloaded the preset for the next game.`,
      validation,
      reload,
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/action') {
    if (!validateSameOrigin(request)) {
      sendJson(response, 403, { error: 'Cross-origin requests are not allowed.' });
      return;
    }
    const body = await readJson(request);
    if (typeof body.server !== 'string' || !loadServers().some((server) => server.name === body.server)) {
      sendJson(response, 400, { error: 'Choose a server from dedicated.toml.' });
      return;
    }
    const command = commandFor(body);
    const result = await runRcon(body.server, command);
    sendJson(response, 200, { result: result || 'Command sent.' });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/download/windows') {
    if (!session) {
      sendJson(response, 401, { error: 'Sign in to download the Windows app.' });
      return;
    }
    const archive = path.join(__dirname, 'dist', 'OmniVault-Reclaimer-Control-win-x64.zip');
    if (!fs.existsSync(archive)) {
      sendJson(response, 404, { error: 'The Windows app package has not been built on this host.' });
      return;
    }
    response.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="OmniVault-Reclaimer-Control-win-x64.zip"',
      'Cache-Control': 'no-store',
      'Content-Length': String(fs.statSync(archive).size),
    });
    const stream = fs.createReadStream(archive);
    stream.on('error', (error) => {
      if (!response.headersSent) sendJson(response, 500, { error: 'Could not read the Windows app package.' });
      else response.destroy(error);
    });
    stream.pipe(response);
    return;
  }

  if (request.method === 'GET' && staticFiles.has(url.pathname)) {
    const [fileName, contentType] = staticFiles.get(url.pathname);
    response.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
    });
    response.end(fs.readFileSync(path.join(PUBLIC, fileName)));
    return;
  }

  sendJson(response, 404, { error: 'Not found.' });
}

if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) {
  throw new Error('PANEL_PORT must be an integer between 1024 and 65535.');
}
if (
  REMOTE_HOST &&
  (!Number.isInteger(REMOTE_PORT) || REMOTE_PORT < 1024 || REMOTE_PORT > 65535 || REMOTE_PORT === PORT)
) {
  throw new Error('PANEL_REMOTE_PORT must be a different integer port between 1024 and 65535.');
}
if (!fs.existsSync(EXECUTABLE)) throw new Error(`Missing Reclaimer executable: ${EXECUTABLE}`);
loadServers();

const handleRequest = (request, response) => {
  handle(request, response).catch((error) => {
    const status = Number.isInteger(error.status) ? error.status : 500;
    if (!response.headersSent) sendJson(response, status, { error: error.message });
    else response.destroy(error);
    if (status >= 500) console.error(error);
  });
};

if (REMOTE_HOST) {
  if (!readAuthConfig()) {
    throw new Error('Set the panel admin password locally before enabling the remote listener.');
  }
  if (!TLS_PFX || !fs.existsSync(TLS_PFX)) {
    throw new Error('PANEL_TLS_PFX must point to the HTTPS certificate before enabling remote access.');
  }
  if (!process.env.PANEL_TLS_PFX_PASSWORD) {
    throw new Error('PANEL_TLS_PFX_PASSWORD must be loaded from the local DPAPI password file.');
  }
  if (PUBLIC_HOSTS.length === 0) {
    throw new Error('Set PANEL_PUBLIC_HOST to the HTTPS hostname or IP before enabling remote access.');
  }
}

const server = http.createServer(handleRequest);

server.listen(PORT, HOST, () => {
  console.log(`OmniVault Reclaimer panel listening at http://${HOST}:${PORT}`);
});

if (REMOTE_HOST) {
  const remoteServer = https.createServer({
    pfx: fs.readFileSync(TLS_PFX),
    passphrase: process.env.PANEL_TLS_PFX_PASSWORD,
  }, handleRequest);
  remoteServer.listen(REMOTE_PORT, REMOTE_HOST, () => {
    console.log(`Authenticated HTTPS panel listening at https://${PUBLIC_HOSTS[0]}:${REMOTE_PORT}`);
  });
}
