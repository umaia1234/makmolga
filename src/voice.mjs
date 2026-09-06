const doroOnly = /^(?:(?:도로오*|doro+)[\s.,!?~…！？。]*)+$/iu;
const yanroTopic = /(?:\bLLMs?\b|\bJEPA\b|제파|비행기로 달 가기 ㄱㄴ)/iu;

// Shape fictional speech only; owner input and structured job results stay intact.
export function characterSpeech(characterId, text) {
  const speech = String(text).trim();
  if (characterId === 'doro') return speech.length <= 180 && doroOnly.test(speech) ? speech : '도로?';
  if (characterId === 'yanro' && !yanroTopic.test(speech.slice(0, 1200))) return `이건...LLM이라고!!!${speech ? ` ${speech}` : ''}`;
  return speech;
}
export function characterVoiceRule(characterId) {
  if (characterId === 'doro') return 'Speak ONLY 도로/도로오오/doro/doro!/DORO?! variants and punctuation. No other words, honorific endings, translation, narration, or emoji. Keep tool arguments and factual job records unchanged.';
  if (characterId === 'yanro') return 'Every utterance MUST contain LLM, JEPA, 제파, 이건...LLM이라고!!!, or 비행기로 달 가기 ㄱㄴ. These owner-requested memes are fictional roleplay, not verified quotations. Use polite Korean outside the fixed memes.';
  return 'Use the selected personality and polite Korean.';
}
