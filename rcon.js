'use strict';

const { execFile } = require('child_process');
const path = require('path');

const EXE = path.join(__dirname, '..', 'project-reclaimer-dedicated-v0.9.21.exe');
const WORKDIR = path.join(__dirname, '..');

function rcon(command, opts = {}) {
  const { server, timeoutMs = 20000 } = typeof opts === 'number' ? { timeoutMs: opts } : opts;
  const args = ['dedicated', 'rcon'];
  if (server) args.push('--server', server);
  args.push(...command);
  return new Promise((resolve, reject) => {
    execFile(
      EXE,
      args,
      { cwd: WORKDIR, timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err && err.killed) {
          reject(new Error(`RCON command timed out: ${command.join(' ')}`));
          return;
        }
        if (err && !stdout && stderr) {
          reject(new Error(stderr.trim() || err.message));
          return;
        }
        resolve((stdout || '').trim());
      }
    );
  });
}

function make(server) {
  return {
    status: () => rcon(['status'], { server }),
    players: () => rcon(['players'], { server }),
    say: (text) => rcon(['say', text], { server }),
    kick: (player, reason) => rcon(['kick', player, ...(reason ? [reason] : [])], { server }),
    ban: (player, time, reason) =>
      rcon(['ban', player, ...(time ? [time] : []), ...(reason ? [reason] : [])], { server }),
    unban: (target) => rcon(['unban', target], { server }),
    map: (mapRef, mode) => rcon(['map', mapRef, ...(mode ? [mode] : [])], { server }),
    load: (mapRef, mode) => rcon(['load', mapRef, ...(mode ? [mode] : [])], { server }),
    nextmap: (mapRef, mode) =>
      rcon(['nextmap', ...(mapRef ? [mapRef, ...(mode ? [mode] : [])] : [])], { server }),
    modes: () => rcon(['modes'], { server }),
    maps: () => rcon(['maps'], { server }),
  };
}

module.exports = {
  rcon,
  make,
  status: () => rcon(['status']),
  players: () => rcon(['players']),
  say: (text) => rcon(['say', text]),
  kick: (player, reason) => rcon(['kick', player, ...(reason ? [reason] : [])]),
  ban: (player, time, reason) =>
    rcon(['ban', player, ...(time ? [time] : []), ...(reason ? [reason] : [])]),
  unban: (target) => rcon(['unban', target]),
  map: (mapRef, mode) => rcon(['map', mapRef, ...(mode ? [mode] : [])]),
  load: (mapRef, mode) => rcon(['load', mapRef, ...(mode ? [mode] : [])]),
  nextmap: (mapRef, mode) =>
    rcon(['nextmap', ...(mapRef ? [mapRef, ...(mode ? [mode] : [])] : [])]),
  modes: () => rcon(['modes']),
  maps: () => rcon(['maps']),
};
