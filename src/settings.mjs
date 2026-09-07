import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { atomicJson } from './store.mjs';

export function backedJson(file, edit) {
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  let old = {};
  if (before != null) { old = JSON.parse(before.replace(/^\uFEFF/, '')); if (!old || typeof old !== 'object' || Array.isArray(old)) throw new Error(`Invalid object: ${file}`); }
  const next = edit(structuredClone(old));
  if (JSON.stringify(old) === JSON.stringify(next)) return { changed: false, file, backup: null };
  const backup = before == null ? null : `${file}.makmolga-${Date.now()}-${randomUUID().slice(0, 8)}.bak`;
  if (backup) fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);
  atomicJson(file, next); return { changed: true, file, backup };
}
