import { createHash } from 'node:crypto';
import { recommendedRoutes } from './config.mjs';

export function resolveRoute(config, characterId) {
  const connections = config.connections;
  const selected = connections?.routing === 'characters' ? connections.characters[characterId] || recommendedRoutes[characterId] : null;
  const provider = selected?.provider || 'codex';
  return { provider, model: provider === 'codex' ? selected?.model || config.controller.model : selected?.model || null,
    command: provider === 'codex' ? config.controller.command : connections?.providers[provider]?.command || null };
}
export function routeKey(route, characterId) {
  const character = characterId || 'unselected';
  // Retain every existing Codex character thread. Other models cannot inherit it.
  if (route.provider === 'codex' && route.model == null) return character;
  const model = createHash('sha256').update(route.model || 'default').digest('hex').slice(0, 16);
  return `${route.provider}/${model}/${character}`;
}
