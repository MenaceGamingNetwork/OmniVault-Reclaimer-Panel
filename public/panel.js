'use strict';

const serverSelect = document.querySelector('#server-select');
const serverList = document.querySelector('#server-list');
const selectedName = document.querySelector('#selected-name');
const selectedStatus = document.querySelector('#selected-status');
const playerList = document.querySelector('#players');
const playerCount = document.querySelector('#player-count');
const lastUpdated = document.querySelector('#last-updated');
const toast = document.querySelector('#toast');
const authScreen = document.querySelector('#auth-screen');
const appShell = document.querySelector('#app-shell');
const authForm = document.querySelector('#auth-form');
let csrfToken = '';
let cachedServers = [];
let toastTimer;
let catalogServer = '';
let gameOptionsServer = '';
let authMode = 'login';
let pollingStarted = false;

function showToast(message, isError = false) {
  toast.textContent = message;
  toast.classList.toggle('error', isError);
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 4200);
}

async function requestJson(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.method && options.method.toUpperCase() !== 'GET' && csrfToken) {
    headers.set('X-Panel-CSRF', csrfToken);
  }
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers,
  });
  const body = await response.json();
  if (response.status === 401 && url !== '/api/auth/state' && url !== '/api/login') {
    csrfToken = '';
    showAuthScreen(false);
  }
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
  return body;
}

function showAuthScreen(setupRequired) {
  authMode = setupRequired ? 'setup' : 'login';
  authScreen.hidden = false;
  appShell.hidden = true;
  document.querySelector('#auth-title').textContent = setupRequired ? 'Create admin password' : 'Sign in';
  document.querySelector('#auth-description').textContent = setupRequired
    ? 'Set a strong password here before enabling remote access.'
    : 'Authenticate to manage your Reclaimer servers.';
  document.querySelector('#auth-password').autocomplete = setupRequired ? 'new-password' : 'current-password';
  document.querySelector('#auth-confirm-label').hidden = !setupRequired;
  document.querySelector('#auth-confirm-password').required = setupRequired;
  document.querySelector('#auth-submit').textContent = setupRequired ? 'Create password' : 'Sign in';
  document.querySelector('#auth-error').hidden = true;
}

async function enterPanel(token) {
  csrfToken = token;
  authScreen.hidden = true;
  appShell.hidden = false;
  if (!pollingStarted) {
    pollingStarted = true;
    setInterval(() => refresh().catch((error) => showToast(error.message, true)), 30000);
  }
  await refresh();
}

async function initializeAuth() {
  const state = await requestJson('/api/auth/state');
  if (state.authenticated) {
    await enterPanel(state.csrfToken);
    return;
  }
  showAuthScreen(state.setupRequired);
}

function currentServer() {
  return cachedServers.find((server) => server.name === serverSelect.value);
}

function catalogNames(output) {
  return output.split(/\r?\n/)
    .map((line) => line.trim().replace(/\s{2,}\([^()]*\)\s*$/, '').trim())
    .filter(Boolean);
}

function playerTotal(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const count = firstLine.match(/(\d+)\s*(?:\/|of)\s*\d+/i);
  return count ? count[1] : String((text.match(/^#\d+/gm) || []).length);
}

function renderTiles(servers) {
  serverList.replaceChildren();
  for (const server of servers) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = `server-tile${server.name === serverSelect.value ? ' selected' : ''}`;
    tile.addEventListener('click', () => {
      serverSelect.value = server.name;
      catalogServer = '';
      gameOptionsServer = '';
      renderSelected();
      renderTiles(cachedServers);
      loadCatalog();
      loadGameOptions();
    });

    const top = document.createElement('div');
    top.className = 'tile-top';
    const name = document.createElement('span');
    name.className = 'tile-name';
    name.textContent = server.name;
    const count = document.createElement('span');
    count.className = 'tile-count';
    count.textContent = server.playersError ? '—' : `${playerTotal(server.players)} online`;
    const status = document.createElement('div');
    status.className = `tile-status${server.error ? ' error' : ''}`;
    status.textContent = server.error ? 'RCON unavailable' : (server.status.split(/\r?\n/)[1] || server.status || 'Online');

    top.append(name, count);
    tile.append(top, status);
    serverList.append(tile);
  }
}

function renderSelected() {
  const server = currentServer();
  if (!server) return;
  selectedName.textContent = server.name;
  selectedStatus.textContent = server.error || server.status || 'No status reply.';
  selectedStatus.classList.toggle('muted', !server.error);
  playerList.textContent = server.playersError || server.players || 'No players connected.';
  playerCount.textContent = server.playersError ? 'Error' : playerTotal(server.players);
}

async function loadCatalog() {
  const server = currentServer();
  if (!server || catalogServer === server.name) return;
  catalogServer = server.name;
  try {
    const data = await requestJson(`/api/catalog?server=${encodeURIComponent(server.name)}`);
    document.querySelector('#map-options').replaceChildren(
      ...catalogNames(data.maps).map((name) => new Option('', name))
    );
    document.querySelector('#mode-options').replaceChildren(
      ...catalogNames(data.modes).map((name) => new Option('', name))
    );
  } catch (error) {
    catalogServer = '';
    showToast(`Could not load map/mode suggestions: ${error.message}`, true);
  }
}

async function loadGameOptions() {
  const server = currentServer();
  if (!server || gameOptionsServer === server.name) return;
  gameOptionsServer = server.name;
  const form = document.querySelector('#game-options-form');
  const message = document.querySelector('#game-options-message');
  form.hidden = true;
  message.textContent = 'Loading the selected preset…';
  try {
    const data = await requestJson(`/api/game-options?server=${encodeURIComponent(server.name)}`);
    if (!data.available) {
      message.textContent = data.reason;
      return;
    }
    document.querySelector('#vehicle-set').value = String(data.mapVehicles);
    document.querySelector('#weapon-set').value = String(data.mapWeapons);
    message.textContent = `Settings for ${data.game}. Changes apply to the next game, not the current match.`;
    form.hidden = false;
  } catch (error) {
    gameOptionsServer = '';
    message.textContent = `Could not load game settings: ${error.message}`;
    showToast(error.message, true);
  }
}

async function refresh() {
  const button = document.querySelector('#refresh');
  button.disabled = true;
  try {
    const data = await requestJson('/api/servers');
    cachedServers = data.servers;
    const selected = serverSelect.value;
    serverSelect.replaceChildren(...cachedServers.map((server) => new Option(server.name, server.name)));
    if (cachedServers.some((server) => server.name === selected)) serverSelect.value = selected;
    renderTiles(cachedServers);
    renderSelected();
    lastUpdated.textContent = `Updated ${new Date().toLocaleTimeString()}`;
    await Promise.all([loadCatalog(), loadGameOptions()]);
  } catch (error) {
    showToast(error.message, true);
    lastUpdated.textContent = 'Status unavailable';
  } finally {
    button.disabled = false;
  }
}

async function sendAction(payload) {
  const server = currentServer();
  if (!server) throw new Error('Select a server first.');
  const result = await requestJson('/api/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, server: server.name }),
  });
  showToast(result.result);
  await refresh();
}

function submitButton(form, event) {
  return event.submitter || form.querySelector('button[type="submit"]');
}

document.querySelector('#refresh').addEventListener('click', refresh);
serverSelect.addEventListener('change', () => {
  catalogServer = '';
  gameOptionsServer = '';
  renderSelected();
  renderTiles(cachedServers);
  loadCatalog();
  loadGameOptions();
});

authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const password = document.querySelector('#auth-password').value;
  const confirmPassword = document.querySelector('#auth-confirm-password').value;
  const errorLabel = document.querySelector('#auth-error');
  errorLabel.hidden = true;
  try {
    const result = await requestJson(authMode === 'setup' ? '/api/setup' : '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password, confirmPassword }),
    });
    authForm.reset();
    await enterPanel(result.csrfToken);
  } catch (error) {
    errorLabel.textContent = error.message;
    errorLabel.hidden = false;
  }
});

document.querySelector('#logout').addEventListener('click', async () => {
  try {
    await requestJson('/api/logout', { method: 'POST' });
  } catch (error) {
    showToast(error.message, true);
  }
  csrfToken = '';
  await initializeAuth();
});

document.querySelector('#say-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await sendAction({ action: 'say', message: form.elements.message.value });
    form.reset();
  } catch (error) {
    showToast(error.message, true);
  }
});

document.querySelector('#map-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const action = submitButton(form, event).value;
  const map = form.elements.map.value;
  const mode = form.elements.mode.value;
  if (action === 'load' && !window.confirm(`Load ${map}${mode ? ` / ${mode}` : ''} now? This ends the current game.`)) return;
  try {
    await sendAction({ action, map, mode });
  } catch (error) {
    showToast(error.message, true);
  }
});

document.querySelector('#game-options-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const server = currentServer();
  if (!server) {
    showToast('Select a server first.', true);
    return;
  }
  const mapVehicles = Number(event.currentTarget.elements.mapVehicles.value);
  const mapWeapons = Number(event.currentTarget.elements.mapWeapons.value);
  if (!window.confirm('Save these map vehicle and weapon sets for the next game? This will not spawn anything in the current match.')) return;
  try {
    const result = await requestJson('/api/game-options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ server: server.name, mapVehicles, mapWeapons }),
    });
    showToast(result.result);
    gameOptionsServer = '';
    await refresh();
  } catch (error) {
    showToast(error.message, true);
  }
});

document.querySelector('#moderation-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const action = submitButton(form, event).value;
  const player = form.elements.player.value;
  if (action === 'ban' && !window.confirm(`Ban ${player} for ${form.elements.duration.value || '30m'}?`)) return;
  try {
    await sendAction({
      action,
      player,
      duration: form.elements.duration.value,
      reason: form.elements.reason.value,
    });
  } catch (error) {
    showToast(error.message, true);
  }
});

document.querySelector('#unban').addEventListener('click', async () => {
  const player = window.prompt('Enter the player ID, device fingerprint, IP address, or range to unban:');
  if (!player) return;
  try {
    await sendAction({ action: 'unban', player });
  } catch (error) {
    showToast(error.message, true);
  }
});

document.querySelector('#end-round').addEventListener('click', async () => {
  if (!window.confirm('End the current round?')) return;
  try {
    await sendAction({ action: 'endround' });
  } catch (error) {
    showToast(error.message, true);
  }
});

document.querySelector('#end-game').addEventListener('click', async () => {
  if (!window.confirm('End the current game now?')) return;
  try {
    await sendAction({ action: 'endgame' });
  } catch (error) {
    showToast(error.message, true);
  }
});

initializeAuth().catch((error) => {
  showAuthScreen(false);
  const errorLabel = document.querySelector('#auth-error');
  errorLabel.textContent = error.message;
  errorLabel.hidden = false;
});
