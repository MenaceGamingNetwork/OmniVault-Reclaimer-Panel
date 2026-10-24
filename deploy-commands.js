'use strict';

// Registers the bot's slash commands with Discord. Usage: node deploy-commands.js
const { REST, Routes, SlashCommandBuilder } = require('discord.js');
const config = require('./config.json');

const serverChoices = config.servers.map((s) => ({ name: s.label, value: s.rcon }));

const commands = [
  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Show what a server is playing')
    .addStringOption((o) => o.setName('server').setDescription('Which server').setRequired(true).addChoices(...serverChoices)),
  new SlashCommandBuilder()
    .setName('players')
    .setDescription('List players on a server')
    .addStringOption((o) => o.setName('server').setDescription('Which server').setRequired(true).addChoices(...serverChoices)),
  new SlashCommandBuilder()
    .setName('say')
    .setDescription('Send a message to players in-game')
    .addStringOption((o) => o.setName('server').setDescription('Which server').setRequired(true).addChoices(...serverChoices))
    .addStringOption((o) => o.setName('message').setDescription('The message').setRequired(true)),
  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a player')
    .addStringOption((o) => o.setName('server').setDescription('Which server').setRequired(true).addChoices(...serverChoices))
    .addStringOption((o) => o.setName('player').setDescription('Player name or tag').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason shown to the player')),
  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a player')
    .addStringOption((o) => o.setName('server').setDescription('Which server').setRequired(true).addChoices(...serverChoices))
    .addStringOption((o) => o.setName('player').setDescription('Player name or tag').setRequired(true))
    .addStringOption((o) => o.setName('time').setDescription('How long, e.g. 1h, 1d, permanent'))
    .addStringOption((o) => o.setName('reason').setDescription('Reason')),
  new SlashCommandBuilder()
    .setName('map')
    .setDescription('Change the map now')
    .addStringOption((o) => o.setName('server').setDescription('Which server').setRequired(true).addChoices(...serverChoices))
    .addStringOption((o) => o.setName('map').setDescription('Map name or file (e.g. Valhalla, riverworld)').setRequired(true))
    .addStringOption((o) => o.setName('mode').setDescription('Game type, e.g. Slayer')),
  new SlashCommandBuilder()
    .setName('nextmap')
    .setDescription('Queue a map for the next game, or list what is queued')
    .addStringOption((o) => o.setName('server').setDescription('Which server').setRequired(true).addChoices(...serverChoices))
    .addStringOption((o) => o.setName('map').setDescription('Map for the next game (omit to list)'))
    .addStringOption((o) => o.setName('mode').setDescription('Game type for the next game')),
].map((c) => c.toJSON());

(async () => {
  const rest = new REST().setToken(config.token);
  const route = config.guildId
    ? Routes.applicationGuildCommands(config.applicationId, config.guildId)
    : Routes.applicationCommands(config.applicationId);
  console.log(`Registering ${commands.length} commands...`);
  await rest.put(route, { body: commands });
  console.log('Done.');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
