'use strict';

// OmniVault Halo server Discord bot.
// - /status /players /say /kick /ban /map /nextmap
// - live status embed (refreshed periodically)
// - join/leave alerts
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  Partials,
} = require('discord.js');
const config = require('./config.json');
const { make } = require('./rcon');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

const byRcon = new Map(config.servers.map((s) => [s.rcon, s]));
const statusMessages = new Map(); // server label -> { channelId, messageId }
const knownPlayers = new Map(); // server label -> Set of names
const lastStatus = new Map(); // server label -> status text

function srv(opt) {
  return opt;
}

async function sendRcon(channel, promise) {
  try {
    const out = await promise;
    const text = out || '(no reply)';
    await channel.send({ content: text.slice(0, 1900) });
  } catch (e) {
    await channel.send(`Error: ${e.message}`.slice(0, 1900));
  }
}

function parsePlayers(text) {
  const names = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^#\d+\s+(\S+)/);
    if (m) names.push(m[1]);
  }
  return names;
}

function buildStatusEmbed(label, statusText, playerText) {
  const lines = statusText.split(/\r?\n/).filter(Boolean);
  const embed = new EmbedBuilder()
    .setColor(0x2f6f2f)
    .setTitle(label)
    .setDescription(lines[1] || lines[0] || statusText)
    .setTimestamp();
  if (lines[2]) embed.addFields({ name: 'Details', value: lines.slice(2).join('\n') });
  if (playerText) {
    const names = parsePlayers(playerText);
    const first = playerText.split(/\r?\n/)[0];
    embed.addFields({
      name: 'Players',
      value: names.length ? `${first}\n${names.join(', ')}`.slice(0, 1024) : first,
    });
  }
  return embed;
}

async function refreshServer(s) {
  const status = await make(s.rcon).status().catch((e) => `Error: ${e.message}`);
  const players = await make(s.rcon).players().catch(() => '');
  lastStatus.set(s.label, status);

  const names = parsePlayers(players);
  const known = knownPlayers.get(s.label) || new Set();
  if (config.alertsChannelId) {
    const alerts = client.channels.cache.get(config.alertsChannelId);
    if (alerts) {
      for (const n of names) if (!known.has(n)) await alerts.send(`**${n}** joined ${s.label}`).catch(() => {});
      for (const n of known) if (!names.includes(n)) await alerts.send(`**${n}** left ${s.label}`).catch(() => {});
    }
  }
  knownPlayers.set(s.label, new Set(names));

  if (config.statusChannelId) {
    const ch = client.channels.cache.get(config.statusChannelId);
    if (!ch) return;
    const embed = buildStatusEmbed(s.label, status, players);
    const prev = statusMessages.get(s.label);
    if (prev && prev.channelId === ch.id) {
      const msg = await ch.messages.fetch(prev.messageId).catch(() => null);
      if (msg) {
        await msg.edit({ embeds: [embed] }).catch(() => {});
        return;
      }
    }
    const sent = await ch.send({ embeds: [embed] }).catch(() => null);
    if (sent) statusMessages.set(s.label, { channelId: ch.id, messageId: sent.id });
  }
}

client.on('interactionCreate', async (i) => {
  if (!i.isChatInputCommand()) return;
  const server = i.options.getString('server');
  const mk = () => make(server);
  const label = byRcon.get(server)?.label || server;

  switch (i.commandName) {
    case 'status':
      await i.deferReply();
      try {
        const status = await mk().status();
        const players = await mk().players().catch(() => '');
        await i.editReply({ embeds: [buildStatusEmbed(label, status, players)] });
      } catch (e) {
        await i.editReply(`Error: ${e.message}`);
      }
      break;
    case 'players':
      await i.deferReply();
      await sendRcon({ send: (c) => i.editReply(c) }, mk().players());
      break;
    case 'say': {
      await i.deferReply();
      const msg = i.options.getString('message', true);
      await sendRcon({ send: (c) => i.editReply(c) }, mk().say(`[Discord] ${i.user.username}: ${msg}`));
      break;
    }
    case 'kick':
      await i.deferReply();
      await sendRcon(
        { send: (c) => i.editReply(c) },
        mk().kick(i.options.getString('player', true), i.options.getString('reason') || undefined)
      );
      break;
    case 'ban':
      await i.deferReply();
      await sendRcon(
        { send: (c) => i.editReply(c) },
        mk().ban(
          i.options.getString('player', true),
          i.options.getString('time') || undefined,
          i.options.getString('reason') || undefined
        )
      );
      break;
    case 'map':
      await i.deferReply();
      await sendRcon(
        { send: (c) => i.editReply(c) },
        mk().map(i.options.getString('map', true), i.options.getString('mode') || undefined)
      );
      break;
    case 'nextmap': {
      await i.deferReply();
      const map = i.options.getString('map');
      if (map) {
        await sendRcon({ send: (c) => i.editReply(c) }, mk().nextmap(map, i.options.getString('mode') || undefined));
      } else {
        await sendRcon({ send: (c) => i.editReply(c) }, mk().nextmap());
      }
      break;
    }
    default:
      await i.reply({ content: 'Unknown command.', ephemeral: true });
  }
});

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  for (const s of config.servers) {
    refreshServer(s).catch((e) => console.error(`${s.label}: ${e.message}`));
  }
  setInterval(() => {
    for (const s of config.servers) refreshServer(s).catch((e) => console.error(`${s.label}: ${e.message}`));
  }, (config.pollSeconds || 30) * 1000);
});

client.login(config.token).catch((e) => {
  console.error('Login failed:', e.message);
  process.exit(1);
});
