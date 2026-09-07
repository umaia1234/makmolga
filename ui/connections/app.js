'use strict';
const $ = id => document.getElementById(id);
let token = location.hash.slice(1);
if (/^[a-f0-9]{64}$/.test(token)) sessionStorage.setItem('makmolga.connection-token', token);
else token = sessionStorage.getItem('makmolga.connection-token') || '';
history.replaceState(null, '', location.pathname);
let state, initialized = false, dirty = false, loginId, loginClosed = false, polling = false, activeTaskId;
let gameInitialized = false, gameDirty = false, gameSettingsKey = '', gameBusy = false;
const names = { codex: 'Codex', claude: 'Claude Code', antigravity: 'Antigravity' };
const logos = { codex: '⌘', claude: '✳', antigravity: '✧' };
const labels = { missing: '설치 필요', broken: '확인 필요', installed: '설치됨', signed_in: '로그인 확인', login_required: '로그인 필요', auth_unknown: '확인 필요' };
const element = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; };
function banner(message, good = false) { $('banner').textContent = message; $('banner').className = `banner${good ? ' success' : ''}`; }
async function api(action, input = {}) {
  const response = await fetch('/api/action', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, input }) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || '요청을 완료하지 못했습니다.'); return result;
}
async function act(action, input) {
  try { const result = await api(action, input); if (result?.note) banner(result.note, true); await poll(); return result; }
  catch (error) { banner(error.message); return null; }
}
function button(text, className, handler) { const node = element('button', className, text); node.type = 'button'; node.addEventListener('click', handler); return node; }
function renderProviders() {
  const target = $('providers'); target.replaceChildren();
  for (const id of ['codex', 'claude', 'antigravity']) {
    const p = state.providers.find(p => p.id === id);
    const verified = p?.installed && p?.auth === 'signed_in' && Object.values(state.checks).some(c => c.provider === id && c.ok);
    const card = element('article', `provider ${id}`), top = element('div', 'provider-top'), title = element('div', 'provider-title');
    title.append(element('span', 'provider-logo', logos[id]), element('span', '', names[id]));
    top.append(title, element('span', `badge ${verified ? 'good' : p?.auth === 'required' ? 'warn' : ''}`, verified ? '연결 시험 통과' : labels[p?.state] || '확인 중'));
    const linked = state.characters.filter(c => (state.connections.routing === 'characters' ? state.connections.characters[c.id]?.provider : 'codex') === id).map(c => c.name).join(' · ');
    card.append(top, element('p', 'desc', linked || '친구와 두뇌 연결에서 선택할 수 있습니다'));
    const steps = element('div', 'steps');
    [p?.installed, p?.auth === 'signed_in', verified].forEach((done, i) => steps.append(element('span', `step${done ? ' done' : ''}`, `${done ? '✓ ' : `${i + 1} `}${['설치', '로그인', '연결 시험'][i]}`)));
    card.append(steps, element('div', 'provider-note', p?.note || (p?.state === 'missing' ? '자동 연결을 누르면 공식 도구를 설치합니다.' : '설치된 프로그램을 확인하고 있습니다.')));
    const actions = element('div', 'provider-actions');
    actions.append(element('span', 'provider-version', p?.installed ? `v${(p.version || '').replace(/^codex-cli\s+/, '').replace(/ \(.*\)/, '')}` : 'OFFICIAL CLI'));
    if (p?.installed) actions.append(button(p.auth === 'signed_in' ? '연결 시험 ↗' : '계정 로그인 ↗', 'secondary', () => p.auth === 'signed_in' ? act('probe', { provider: id, model: null }) : startLogin(id)));
    else actions.append(button('설치하기 ↓', 'secondary', () => act('install', { provider: id })));
    card.append(actions); target.append(card);
  }
}
function selectedRoute(id) {
  return { provider: $(`provider-${id}`).value, model: $(`model-${id}`).value.trim() || null };
}
function renderCharacters() {
  const target = $('character-rows'); target.replaceChildren();
  const order = ['gemchan', 'clchan', 'fablechan', 'gpchan', 'yanro', 'doro', 'spiki'];
  for (const id of order) {
    const c = state.characters.find(c => c.id === id); if (!c) continue;
    const route = state.connections.routing === 'characters' ? state.connections.characters[id] || { provider: 'codex', model: null } : state.fallbackRoute || { provider: 'codex', model: null };
    const row = element('div', 'character-row'), identity = element('div', 'character-name'), avatar = element('span', 'avatar'); avatar.dataset.id = id;
    const info = element('div'), name = element('strong', '', c.name);
    if (['clchan', 'fablechan'].includes(id)) name.append(element('span', 'new-label', 'NEW'));
    info.append(name, element('small', '', c.tagline)); identity.append(avatar, info);
    const select = element('select'); select.id = `provider-${id}`; select.setAttribute('aria-label', `${c.name} 연결 서비스`);
    for (const [value, label] of Object.entries(names)) { const option = element('option', '', label); option.value = value; select.append(option); }
    select.value = route.provider;
    const model = element('input'); model.id = `model-${id}`; model.value = route.model || ''; model.placeholder = '계정 기본 모델'; model.maxLength = 160; model.setAttribute('aria-label', `${c.name} 모델 이름`);
    model.setAttribute('list', `models-${id}`); const options = element('datalist'); options.id = `models-${id}`;
    if (route.provider === 'claude') for (const v of ['opus', 'sonnet', 'fable']) { const option = element('option'); option.value = v; options.append(option); }
    const inputWrap = element('div'); inputWrap.append(model, options);
    const test = button('연결 시험', 'test-button', () => act('probe', selectedRoute(id))); test.id = `test-${id}`;
    const changed = () => { dirty = true; $('routing').checked = true; $('save-note').textContent = '변경 사항이 있습니다. 저장한 뒤 실행 중인 동료에 적용해 주세요.'; updateCheck(id); };
    select.addEventListener('change', () => { options.replaceChildren(); if (select.value === 'claude') for (const v of ['opus', 'sonnet', 'fable']) { const option = element('option'); option.value = v; options.append(option); } changed(); }); model.addEventListener('input', changed);
    row.append(identity, select, inputWrap, test); target.append(row);
  }
  $('routing').checked = state.connections.routing === 'characters'; initialized = true; updateChecks();
}
function updateCheck(id) { const route = selectedRoute(id), provider = state.providers.find(p => p.id === route.provider), checked = provider?.installed && provider.auth === 'signed_in' && state.checks[`${route.provider}:${route.model || 'default'}`]?.ok; const b = $(`test-${id}`); b.textContent = checked ? '✓ 확인됨' : '연결 시험'; b.classList.toggle('verified', !!checked); }
function updateChecks() { for (const c of state.characters) if ($(`test-${c.id}`)) updateCheck(c.id); }
function renderTasks() {
  const target = $('task-list'); target.replaceChildren();
  const tasks = [...state.tasks].reverse();
  const checks = Object.values(state.checks).map(c => ({ state: 'done', label: `${names[c.provider]} · ${c.model || '기본 모델'}`, progress: `${c.note} · ${(c.elapsedMs / 1000).toFixed(1)}초`, startedAt: c.checkedAt }));
  for (const task of [...tasks, ...checks].slice(0, 8)) {
    const row = element('div', `task-item ${task.state}`), body = element('div', 'task-body');
    body.append(element('strong', '', task.label), element('p', '', task.error || task.progress));
    row.append(element('span', 'task-icon', task.state === 'running' ? '◌' : task.state === 'failed' ? '!' : '✓'), body, element('time', 'task-time', new Date(task.startedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })));
    target.append(row);
  }
  if (!target.children.length) target.append(element('div', 'empty-state', '연결 시험을 시작하면 실제 모델 응답과 도구 확인 결과가 여기에 표시됩니다.'));
  const running = tasks.find(t => t.state === 'running');
  for (const id of ['auto', 'refresh', 'apply', 'save']) $(id).disabled = !!running;
  for (const b of document.querySelectorAll('.test-button,.provider-actions button')) b.disabled = !!running;
  if (running) { activeTaskId = running.id; banner(running.progress, true); }
  else if (activeTaskId) { const finished = tasks.find(t => t.id === activeTaskId); if (finished) { banner(finished.error || `${finished.label} — ${finished.result?.note || '완료되었습니다.'}`, finished.state === 'done'); if (finished.result?.applied) $('save-note').textContent = '실행 중인 동료에 적용했습니다. 다음 대화부터 이 연결을 사용합니다.'; } activeTaskId = null; }
}
async function startLogin(provider) {
  const result = await act('login', { provider }); if (!result) return;
  loginId = result.id; loginClosed = false; $('login-panel').classList.remove('hidden'); $('login-panel').scrollIntoView({ block: 'center' }); await poll();
}
function renderLogin() {
  if (loginClosed) return;
  loginId ||= state.logins.findLast(l => ['starting', 'waiting', 'verifying'].includes(l.state))?.id;
  if (!loginId) return;
  const l = state.logins.find(l => l.id === loginId); if (!l) return;
  $('login-panel').classList.remove('hidden'); $('login-title').textContent = `${names[l.provider]} 계정 연결`;
  $('login-link').classList.toggle('hidden', !l.url); if (l.url) $('login-link').href = l.url;
  $('code-form').classList.toggle('hidden', !(l.acceptsCode && l.state === 'waiting'));
  $('login-note').textContent = l.state === 'done' ? '로그인이 완료되었습니다. 이제 연결 시험을 눌러 보세요.' : ['expired', 'failed'].includes(l.state) ? '로그인이 만료되었습니다. 서비스 카드의 계정 로그인 버튼으로 다시 시작해 주세요.' : l.state === 'verifying' ? '인증 코드를 확인하고 있습니다.' : l.state === 'starting' ? '공식 로그인 페이지를 준비하고 있습니다.' : l.acceptsCode ? '공식 로그인 페이지에서 계정을 선택한 뒤, 표시되는 인증 코드를 아래에 입력해 주세요.' : '공식 로그인 페이지에서 계정 연결을 완료해 주세요. 이 화면이 자동으로 갱신됩니다.';
  if (l.state === 'waiting' && l.expiresAt) $('login-note').textContent += ` · 남은 시간 ${Math.max(0, Math.ceil((l.expiresAt - Date.now()) / 1000))}초`;
}
async function poll() {
  if (polling) return; polling = true;
  try {
    const response = await fetch('/api/state', { headers: { Authorization: `Bearer ${token}` } }); const next = await response.json();
    if (!response.ok) throw new Error(next.error || '연결 센터에 접속하지 못했습니다.');
    const previous = state; state = next;
    if (JSON.stringify(previous?.providers) !== JSON.stringify(state.providers) || JSON.stringify(previous?.checks) !== JSON.stringify(state.checks)) renderProviders();
    if (!initialized || (!dirty && JSON.stringify(previous?.connections) !== JSON.stringify(state.connections))) renderCharacters();
    updateChecks(); renderTasks(); renderLogin(); renderGame();
  } catch (error) { banner(error.message); } finally { polling = false; }
}
$('auto').addEventListener('click', () => act('auto'));
$('refresh').addEventListener('click', () => act('refresh'));
$('routing').addEventListener('change', () => { dirty = true; $('save-note').textContent = '변경 사항을 저장해 주세요.'; });
$('save').addEventListener('click', async () => {
  const routes = Object.fromEntries(state.characters.filter(c => $(`provider-${c.id}`)).map(c => [c.id, selectedRoute(c.id)]));
  const result = await act('save', { routing: $('routing').checked ? 'characters' : 'legacy', characters: routes });
  if (result) { dirty = false; $('save-note').textContent = '저장했습니다. 실행 중이라면 설정 적용을 눌러 주세요.'; banner('설정을 저장했습니다. 다음 실행부터 자동으로 사용하며, 실행 중인 동료에는 설정 적용을 눌러 주세요.', true); }
});
$('apply').addEventListener('click', async () => { if (dirty) return banner('먼저 변경 사항을 저장해 주세요.'); await act('apply'); });
$('code-form').addEventListener('submit', async e => { e.preventDefault(); const code = $('login-code').value; $('login-code').value = ''; await act('login-code', { id: loginId, code }); });
$('login-dismiss').addEventListener('click', () => { loginClosed = true; $('login-panel').classList.add('hidden'); });
const gameFields = { gameDirectory: 'game-directory', host: 'game-host', port: 'game-port', ownerName: 'game-owner', ownerUuid: 'game-uuid', botName: 'game-bot', accountIndex: 'game-account-index', prefix: 'game-prefix', autonomy: 'game-autonomy', vision: 'game-vision' };
function gameInput() {
  return Object.fromEntries(Object.entries(gameFields).map(([key, id]) => [key, ['autonomy', 'vision'].includes(key) ? $(id).checked : ['port', 'accountIndex'].includes(key) ? Number($(id).value) : key === 'prefix' ? ($(id).value === 'custom' ? state.game.settings.prefix : $(id).value) : $(id).value.trim()]));
}
function renderGame() {
  const game = state.game; if (!game) return;
  const key = JSON.stringify(game.settings);
  if (!gameInitialized || (!gameDirty && gameSettingsKey !== key)) {
    for (const [name, id] of Object.entries(gameFields)) {
      if (['autonomy', 'vision'].includes(name)) $(id).checked = !!game.settings[name];
      else $(id).value = name === 'prefix' && !['', '!봇 '].includes(game.settings[name]) ? 'custom' : game.settings[name];
    }
    gameSettingsKey = key; gameInitialized = true;
    $('owner-confirmation').textContent = game.settings.ownerUuid ? '사용자 식별 정보가 저장되어 있습니다.' : '이름 확인으로 내 계정의 식별 정보를 가져옵니다.';
  }
  if (game.version) $('release-version').textContent = `v${game.version} · JAVA 26.2`;
  const list = $('game-components'); list.replaceChildren();
  for (const [ready, label] of [[game.modInstalled, '최신 동료 모드'], [game.java?.available, 'Java 실행 환경'], [game.proxyReady, '게임 연결 프로그램']]) {
    const li = element('li', ready ? 'done' : ''); li.append(element('span', '', ready ? '✓' : '·'), document.createTextNode(`${label} ${ready ? '준비됨' : '준비 필요'}`)); list.append(li);
  }
  const s = game.session || {}, connected = s.connection === 'connected', blocked = !!s.halted;
  const busy = state.tasks.some(t => t.state === 'running');
  for (const id of ['game-install', 'game-prepare', 'game-save', 'game-server', 'game-login']) $(id).disabled = busy;
  $('game-start').disabled = busy || gameDirty || !game.settings.ownerUuid;
  $('game-stop').disabled = !s.running || blocked;
  $('game-resume').classList.toggle('hidden', !blocked);
  $('game-shutdown').disabled = !s.running;
  $('game-readiness').textContent = blocked ? '중지됨' : connected && s.ready ? '함께하는 중' : s.running ? '연결 확인 필요' : game.settings.ownerUuid ? '설정 저장됨' : '처음 설치';
  $('game-readiness').classList.toggle('good', connected && !!s.ready && !blocked);
  $('game-status-title').textContent = blocked ? '친구가 잠시 멈춰 있습니다.' : connected && s.ready ? '같은 세계에서 기다리고 있어요.' : s.running ? '동료의 연결을 확인하고 있습니다.' : '준비가 끝나면, 함께 시작해 주세요.';
  $('game-status-note').textContent = game.sessionError || s.error || (blocked ? `${s.halted} · 게임을 확인한 뒤 다시 움직이기를 눌러 주세요.` : connected && s.ready ? '게임에서 H로 캐릭터를 고르고 말을 걸어 보세요. “저랑 같이 걸어요”도 좋습니다.' : '게임 서버에 먼저 들어간 뒤 사용할 AI에 로그인하고 함께 시작을 눌러 주세요.');
  $('game-status-title').closest('.play-bar').classList.toggle('connected', connected && !!s.ready);
}
for (const id of Object.values(gameFields)) $(id).addEventListener('input', () => { gameDirty = true; $('game-save-note').textContent = '변경한 게임 설정을 저장해 주세요.'; $('game-start').disabled = true; });
$('game-owner').addEventListener('input', () => { $('game-uuid').value = ''; $('owner-confirmation').textContent = '바꾼 게임 이름을 확인해 주세요.'; });
$('game-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!$('game-uuid').value) { banner('내 게임 이름 옆의 이름 확인을 먼저 눌러 주세요.'); $('game-lookup').focus(); return; }
  const result = await act('game-save', gameInput());
  if (result) { gameDirty = false; $('game-save-note').textContent = '저장했습니다. 사용할 AI에 로그인하고 함께 시작해 주세요.'; renderGame(); }
});
$('game-lookup').addEventListener('click', async () => {
  $('game-lookup').disabled = true;
  try { const result = await act('game-lookup', { name: $('game-owner').value.trim() }); if (result) { $('game-owner').value = result.ownerName; $('game-uuid').value = result.ownerUuid; $('owner-confirmation').textContent = `${result.ownerName} · 공식 Java 프로필을 확인했습니다.`; gameDirty = true; $('game-save-note').textContent = '이름을 확인했습니다. 게임 설정 저장을 눌러 주세요.'; } }
  finally { $('game-lookup').disabled = false; }
});
$('game-install').addEventListener('click', () => act('game-install', { gameDirectory: $('game-directory').value.trim() }));
for (const name of ['prepare', 'server', 'login', 'start', 'stop', 'resume', 'shutdown']) $(`game-${name}`).addEventListener('click', () => {
  if (['server', 'start'].includes(name) && gameDirty) return banner('먼저 게임 설정을 저장해 주세요.');
  return act(`game-${name}`);
});
poll(); setInterval(poll, 1800);
setInterval(async () => { if (!state || gameBusy || document.hidden) return; gameBusy = true; try { await api('game-status'); await poll(); } catch {} finally { gameBusy = false; } }, 12000);
