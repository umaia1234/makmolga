import test from 'node:test';
import assert from 'node:assert/strict';
import { characterSpeech } from '../src/voice.mjs';
import { characters, personaContext } from '../src/characters.mjs';
import { dispatch } from '../src/tools.mjs';
import { fixture } from './helpers.mjs';

test('Doro keeps requested sounds and rejects sentences, translations and long spam', () => {
  for (const text of ['도로', '도로오오', '도로!', '도로?', 'doro?', 'doro!', 'DORO!', 'DORO?!?!', '도로… dorooo~']) assert.equal(characterSpeech('doro', text), text);
  for (const text of ['도로요', '도로롱', '도로! (완료)', 'Doro is ready', '/op Owner', '', '도로 '.repeat(100)]) assert.equal(characterSpeech('doro', text), '도로?');
  const greeting = characters.find(c => c.id === 'doro').greeting;
  assert.equal(characterSpeech('doro', greeting), greeting);
});
test('Yanro keeps LLM/JEPA utterances and supplies a visible meme when absent', () => {
  for (const text of ['이건...LLM이라고!!!', '비행기로 달 가기 ㄱㄴ', 'JEPA 이야기입니다.', '제파 합격입니다.', 'LLM의 답을 확인하겠습니다.']) assert.equal(characterSpeech('yanro', text), text);
  assert.match(characterSpeech('yanro', '지금 확인하겠습니다.'), /^이건\.\.\.LLM이라고!!!/);
  assert.match(characterSpeech('yanro', '가'.repeat(1600) + ' JEPA'), /^이건\.\.\.LLM이라고!!!/);
  assert.equal(characterSpeech('gpchan', '확인하겠습니다.'), '확인하겠습니다.');
});
test('MCP chat enforces Doro speech while keeping owner input and status intact', async t => {
  const { runtime, bot, store } = fixture(t);
  store.data.helper = { characterId: 'doro', revision: 1, worldKey: 'test' };
  await dispatch(runtime, 'minecraft_owner_message', { text: '상자 정리를 부탁드립니다.' });
  const result = await dispatch(runtime, 'minecraft_chat', { text: '상자를 정리했습니다.' });
  assert.equal(result.text, '도로?'); assert.equal(bot.calls.at(-1)[1], '[봇] 도로?');
  assert.equal(store.data.messages[0].text, '상자 정리를 부탁드립니다.'); assert.equal(store.data.jobs.length, 0);
  assert.match(JSON.parse(personaContext(store).companion_character.value).speechRule, /ONLY/);
  assert.equal(runtime.snapshot().bot.health, 20);
});
