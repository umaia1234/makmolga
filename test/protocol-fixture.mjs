import protocol from 'minecraft-protocol';
import minecraftData from 'minecraft-data';
import chunkLoader from 'prismarine-chunk';
import { Vec3 } from 'vec3';
import { once } from 'node:events';

// A local packet fixture, not Mojang's game server. No saved world or licensed server binary.
export async function protocolFixture() {
  const data = minecraftData('26.1'); const Chunk = chunkLoader('26.1');
  const server = protocol.createServer({ host: '127.0.0.1', port: 0, version: '26.1', 'online-mode': false, registryCodec: data.loginPacket.dimensionCodec, motd: 'Companion protocol fixture', hideErrors: true });
  const packets = []; const errors = []; const clients = [];
  server.on('error', error => errors.push(error.message));
  server.on('connection', client => client.on('state', state => {
    if (state === 'configuration') client.write('select_known_packs', { packs: [] });
  }));
  server.on('playerJoin', client => {
    clients.push(client); client.on('error', error => errors.push(error.message));
    client.on('packet', (packet, meta) => { if (['position', 'position_look', 'flying', 'look', 'chat_message'].includes(meta.name)) packets.push({ name: meta.name, packet }); });
    client.write('login', { ...data.loginPacket, entityId: 1, viewDistance: 2, simulationDistance: 2 });
    for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
      const chunk = new Chunk({ minY: -64, worldHeight: 384 });
      for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) chunk.setBlockStateId(new Vec3(x, 63, z), data.blocksByName.stone.defaultState);
      client.write('map_chunk', { x: cx, z: cz, heightmaps: [], chunkData: chunk.dump(), blockEntities: [], skyLightMask: [], blockLightMask: [], emptySkyLightMask: [], emptyBlockLightMask: [], skyLight: [], blockLight: [] });
    }
    client.write('update_health', { health: 20, food: 20, foodSaturation: 5 });
    client.write('position', { teleportId: 1, x: 0.5, y: 64, z: 0.5, dx: 0, dy: 0, dz: 0, yaw: 0, pitch: 0, flags: {} });
  });
  await once(server, 'listening');
  return { server, port: server.socketServer.address().port, clients, packets, errors, close: () => { server.close(); for (const client of clients) { client.socket?.destroy(); clearTimeout(client.closeTimer); } } };
}
