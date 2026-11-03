import { REST, Routes } from 'discord.js';
import { loadConfig, loadDotEnv } from '../config.js';
import { commandsJson } from './commands/definitions.js';

/** 슬래시 명령어를 디스코드에 등록 (봇이 켜질 때도 자동으로 등록되므로 보통은 필요 없음) */
loadDotEnv();
const config = loadConfig({ ...process.env, ARCHIVE_DRIVER: 'local' });
const { token, clientId, guildId } = config.discord;
if (!token || !clientId) {
  console.error('DISCORD_TOKEN 과 DISCORD_CLIENT_ID 가 필요합니다.');
  process.exit(1);
}
const body = commandsJson();
const rest = new REST().setToken(token);
await rest.put(guildId ? Routes.applicationGuildCommands(clientId, guildId) : Routes.applicationCommands(clientId), { body });
console.log(`✅ 명령어 ${body.length}개를 ${guildId ? `서버(${guildId})` : '전역'}에 등록했습니다.`);
