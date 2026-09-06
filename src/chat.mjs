import { createHash } from 'node:crypto';

export const normalUuid = value => String(value || '').replaceAll('-', '').toLowerCase();
export function ownerChat(config, packet, players = {}) {
  if (!config.owner.uuid || normalUuid(packet.sender) !== normalUuid(config.owner.uuid)) return null;
  if (config.owner.requireVerifiedChat && packet.verified !== true) return null;
  const known = Object.values(players).find(p => normalUuid(p.uuid) === normalUuid(packet.sender));
  if (known && config.owner.username && known.username.toLowerCase() !== config.owner.username.toLowerCase()) return null;
  // Use the signed/plain protocol field; never parse a rendered '<name> text' or system message.
  if (typeof packet.plainMessage !== 'string' || !packet.plainMessage.startsWith(config.owner.prefix)) return null;
  const text = packet.plainMessage.slice(config.owner.prefix.length).trim();
  if (!text || text.length > 2000) return null;
  const identity = packet.signature ? Buffer.from(packet.signature).toString('hex') : null;
  return { ...(identity ? { id: createHash('sha256').update(`${packet.sender}:${identity}`).digest('hex') } : {}), text, source: 'minecraft', owner: config.owner.uuid };
}
export function chatLines(text, maxLines = 8, label = '봇', format = value => value) {
  const clean = String(text).replace(/§./g, '').replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim();
  const chars = Array.from(clean); const lines = [];
  for (let i = 0; i < chars.length && lines.length < maxLines; i += 180) {
    let body = chars.slice(i, i + 180).join('');
    if (lines.length === maxLines - 1 && chars.length > maxLines * 180) body += ' … (전체 답변은 Codex에서 확인)';
    lines.push(`[${label}] ${format(body)}`);
  }
  return lines;
}
