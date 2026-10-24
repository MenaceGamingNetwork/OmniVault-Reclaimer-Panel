'use strict';

// Quick RCON test against the live server. Usage: node test-rcon.js [server-name]
const { rcon } = require('./rcon');

const server = process.argv[2];

(async () => {
  for (const cmd of ['status', 'players']) {
    console.log(`\n=== ${cmd} ===`);
    try {
      const out = await rcon([cmd], { server });
      console.log(out || '(empty)');
    } catch (e) {
      console.error('Error:', e.message);
    }
  }
})();
