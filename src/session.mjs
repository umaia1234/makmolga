import { setTimeout as delay } from 'node:timers/promises';

// Startup orchestration is separate from OS launching so reuse, failure and safety
// behavior can be tested without stopping the player's real world.
export async function ensureSession(config, services, { timeoutMs = 180000, intervalMs = 500 } = {}) {
  if (!config.owner.uuid) throw new Error('Set owner.uuid before starting chat standby.');
  if (!config.controller.enabled) throw new Error('Enable controller.enabled in config.local.json first.');
  const deadline = Date.now() + timeoutMs;
  const wait = async () => { if (Date.now() >= deadline) throw new Error('Startup timed out. Inspect runtime/stderr.log and local-world/logs/latest.log.'); await delay(intervalMs); };
  const checked = session => {
    if (!session) return null;
    if (session.protocol !== 1) throw new Error('Runtime needs updating and a restart before session standby is available.');
    if (session.server.host !== config.minecraft.host || session.server.port !== config.minecraft.port || session.owner.uuid !== config.owner.uuid || session.owner.prefix !== config.owner.prefix) throw new Error('Running runtime has different connection/chat settings. Inspect and restart it before continuing.');
    if (session.runtime.halted) throw new Error(`Bot is halted: ${session.runtime.halted}. Inspect the game before resuming.`);
    if (!session.controller.enabled || session.controller.fault || session.controller.closed) throw new Error(session.controller.error || 'Controller is disabled or faulted. Inspect events before restarting.');
    return session;
  };
  let session = checked(await services.probe());
  const reusedRuntime = !!session;
  if (!session) {
    if (!await services.runtimeAlive()) {
      await services.ensureServer(deadline);
      await services.startRuntime();
    }
    do { await wait(); session = checked(await services.probe()); } while (!session);
  }
  // Starting/resuming the RPC thread does not invent a user message or ask the LLM to generate.
  session = checked(await services.prepare());
  if (!session.controller.ready) throw new Error('Codex controller did not become ready.');
  if (session.runtime.connection === 'disconnected') {
    await services.ensureServer(deadline);
    await services.connect();
  }
  while (session.runtime.connection !== 'connected') { await wait(); session = checked(await services.probe()); if (!session) throw new Error('Runtime exited while connecting.'); }
  if (!session.controller.ready) throw new Error('Codex controller disconnected during startup.');
  return { ready: true, mode: session.runtime.activeJob || session.controller.activeTurn || session.runtime.pendingMessages ? 'working' : 'waiting_for_owner_chat',
    reusedRuntime, pid: session.pid, server: session.server, owner: session.owner,
    helper: session.runtime.helper, controller: session.controller, bot: session.runtime.bot,
    activeJob: session.runtime.activeJob, pendingMessages: session.runtime.pendingMessages };
}
