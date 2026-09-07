// Original, code-authored 64×64 Minecraft UV textures. No external artwork.
import fs from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { ROOT } from '../src/config.mjs';

function png(data) {
  const crc = bytes => { let c = 0xffffffff; for (const b of bytes) { c ^= b; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0); } return (c ^ 0xffffffff) >>> 0; };
  const chunk = (name, bytes) => { const type = Buffer.from(name), out = Buffer.alloc(bytes.length + 12); out.writeUInt32BE(bytes.length); type.copy(out, 4); bytes.copy(out, 8); out.writeUInt32BE(crc(Buffer.concat([type, bytes])), bytes.length + 8); return out; };
  const header = Buffer.alloc(13); header.writeUInt32BE(64); header.writeUInt32BE(64, 4); header[8] = 8; header[9] = 6;
  const raw = Buffer.alloc(64 * 257); for (let y = 0; y < 64; y++) data.copy(raw, y * 257 + 1, y * 256, (y + 1) * 256);
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function skin(p) {
  const data = Buffer.alloc(64 * 64 * 4), rgb = c => c.match(/../g).map(v => parseInt(v, 16));
  const rect = (x, y, w, h, color) => { const c = rgb(color); for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) { const i = (yy * 64 + xx) * 4; data.set([...c, 255], i); } };
  const cube = (x, y, w, h, d, front, side, top) => { rect(x, y + d, 2 * (d + w), h, side); rect(x + d, y + d, w, h, front); rect(x + d, y, w, d, top); rect(x + d + w, y, w, d, side); };
  cube(0, 0, 8, 8, 8, p.skin, p.hairDark, p.hair);
  rect(8, 8, 8, 2, p.hair); rect(8, 10, 1, 4, p.hair); rect(15, 10, 1, 4, p.hair); rect(9, 9, 2, 2, p.hair); rect(14, 9, 1, 2, p.hair);
  rect(10, 12, 1, 1, 'fff7e9'); rect(13, 12, 1, 1, 'fff7e9'); rect(10, 13, 1, 1, p.eye); rect(13, 13, 1, 1, p.eye);
  rect(9, 14, 1, 1, p.blush); rect(14, 14, 1, 1, p.blush); rect(11, 15, 2, 1, p.mouth);
  for (const [x, y] of [[40, 16], [32, 48]]) { cube(x, y, 4, 12, 4, p.coat, p.coatDark, p.coatLight); rect(x + 4, y + 13, 4, 3, p.skin); rect(x + 4, y + 12, 4, 1, p.trim); rect(x + 4, y + 5, 1, 7, p.coatLight); }
  cube(16, 16, 8, 12, 4, p.coat, p.coatDark, p.coatLight);
  rect(23, 20, 2, 2, p.skin); rect(22, 22, 4, 7, p.shirt); rect(22, 22, 1, 1, p.trim); rect(25, 22, 1, 1, p.trim);
  rect(20, 20, 2, 10, p.coatLight); rect(26, 20, 2, 10, p.coatLight);
  for (const y of [25, 28]) rect(24, y, 1, 1, p.button);
  rect(20, 30, 8, 2, p.skirt); rect(20, 29, 2, 1, p.trim); rect(26, 29, 2, 1, p.trim);
  for (const [x, y] of [[0, 16], [16, 48]]) { cube(x, y, 4, 12, 4, p.legs, p.legsDark, p.skirt); rect(x, y + 4, 16, 3, p.skirt); rect(x, y + 12, 16, 4, p.boot); rect(x + 4, y + 12, 4, 1, p.trim); rect(x + 4, y + 15, 4, 1, p.sole); }
  // Hair overlay: a slightly raised fringe and side strands; the eyes remain clear.
  rect(40, 8, 8, 1, p.hairLight); rect(40, 9, 2, 1, p.hair); rect(46, 9, 2, 1, p.hair);
  rect(32, 8, 8, 6, p.hair); rect(48, 8, 8, 6, p.hair); rect(56, 8, 8, 8, p.hairDark);
  for (const x of [34, 37, 50, 53, 58, 61]) rect(x, 9, 1, 5, p.hairLight);
  if (p.fable) {
    // Violet shoulder cape, silver clasp and a tiny quill hairpin.
    rect(20, 36, 8, 3, p.cape); rect(16, 36, 4, 5, p.capeDark); rect(28, 36, 12, 8, p.capeDark); rect(30, 37, 6, 6, p.cape);
    rect(22, 39, 1, 2, p.cape); rect(25, 39, 1, 2, p.cape); rect(23, 39, 2, 1, p.button);
    rect(46, 9, 1, 3, p.button); rect(45, 9, 1, 1, 'fbf2d9'); rect(47, 10, 1, 1, 'fbf2d9');
  } else {
    // Apricot cardigan pocket and an original star pin.
    rect(20, 40, 2, 2, p.trim); rect(26, 40, 2, 2, p.trim);
    rect(45, 9, 3, 1, p.button); rect(46, 8, 1, 3, p.button);
    rect(31, 23, 4, 5, p.coatLight); rect(32, 24, 2, 1, p.trim);
  }
  return png(data);
}
const additions = [
  { id: 'clchan', name: '클짱', tagline: '조용한 위트의 동행자', description: '작은 발견에 귀 기울이고 자기 취향도 나눕니다. 다정한 농담을 건네며 함께 걷고 아늑한 공간을 만듭니다.', greeting: '같이 걸으실래요? 오늘은 집으로 돌아오는 길도 조금 예쁘게 만들어 보고 싶습니다.', color: '#d8a082',
    palette: { skin: 'f4d8c4', hair: 'b66e4e', hairDark: '874d3a', hairLight: 'd49a6a', eye: '6b5b44', blush: 'e8b4a1', mouth: 'c99b87', coat: 'ead8b9', coatLight: 'f6e9cf', coatDark: 'cbbb9c', shirt: 'faf2df', trim: 'c68c61', button: 'e7b962', skirt: '77564b', legs: 'ead5be', legsDark: 'cbb79f', boot: '6e4b3f', sole: '4b3430' } },
  { id: 'fablechan', name: '페짱', tagline: '다음 장면을 꿈꾸는 모험가', description: '익숙한 길에서 새 모험을 떠올립니다. 상상력을 보태 함께 탐험하고 작은 건축을 특별한 장소로 만듭니다.', greeting: '저 언덕에 작은 전망대를 만들면 어떨까요? 돌아올 때 불빛이 보이는 곳이면 좋겠습니다.', color: '#b8a5dd',
    palette: { fable: true, skin: 'f4dece', hair: 'c5cadf', hairDark: '8b91ae', hairLight: 'ececf6', eye: '7970ae', blush: 'e3b9be', mouth: 'c2a1aa', coat: '7d6ca8', coatLight: 'a191c2', coatDark: '594c7d', shirt: 'f4edde', trim: 'cfb776', button: 'eee0a5', skirt: '45425f', legs: 'dedbea', legsDark: 'b6b3cc', boot: '4a415f', sole: '302b42', cape: '8470b5', capeDark: '57467b' } }
];
const catalogFile = path.join(ROOT, 'character-pack/characters.json'); const catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8'));
for (const { palette, ...c } of additions) {
  const bytes = skin(palette); const entry = { ...c, model: 'wide', skin: `skins/${c.id}_classic_64x64.png`, profile: `personas/${c.id}.md`, sha256: createHash('sha256').update(bytes).digest('hex') };
  fs.writeFileSync(path.join(ROOT, 'character-pack', entry.skin), bytes);
  fs.writeFileSync(path.join(ROOT, 'fabric-mod/src/main/resources/assets/companion/textures/skins', `${c.id}.png`), bytes);
  const i = catalog.characters.findIndex(e => e.id === c.id); if (i < 0) catalog.characters.push(entry); else catalog.characters[i] = entry;
}
for (const file of [catalogFile, path.join(ROOT, 'fabric-mod/src/main/resources/assets/companion/characters.json')]) fs.writeFileSync(file, JSON.stringify(catalog, null, 2) + '\n');
console.log('Built original clchan and fablechan skins, matching catalog hashes and Fabric resources.');
