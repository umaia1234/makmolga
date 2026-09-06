package local.companion;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientLifecycleEvents;
import net.fabricmc.fabric.api.client.keymapping.v1.KeyMappingHelper;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayConnectionEvents;
import net.fabricmc.fabric.api.client.screen.v1.ScreenEvents;
import net.fabricmc.fabric.api.client.screen.v1.Screens;
import net.fabricmc.loader.api.FabricLoader;
import com.mojang.blaze3d.platform.InputConstants;
import java.util.List;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.*;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.Identifier;
import net.minecraft.world.level.storage.LevelResource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public final class CompanionClient implements ClientModInitializer {
    public static final Logger LOGGER = LoggerFactory.getLogger("companion");
    public List<CharacterCatalog.Character> characters;
    public WorldMemory memory;
    public final LocalBridge bridge = new LocalBridge();
    public String worldKey;
    public String worldLabel = "캐릭터 미리보기";
    public String bridgeNote = "연결을 설정하면 선택한 성격으로 대화할 수 있습니다.";
    private boolean joined, prompted, previewOpened, syncing;
    private int joinTicks;
    private long retryAt;
    private KeyMapping selectorKey;
    @Override public void onInitializeClient() {
        characters = CharacterCatalog.load();
        try { memory = new WorldMemory(FabricLoader.getInstance().getConfigDir().resolve("companion-selector.json")); }
        catch (Exception e) { throw new IllegalStateException("Cannot open companion preferences", e); }
        var category = KeyMapping.Category.register(Identifier.fromNamespaceAndPath("companion", "helpers"));
        selectorKey = KeyMappingHelper.registerKeyMapping(new KeyMapping("key.companion.select", InputConstants.Type.KEYSYM, InputConstants.KEY_H, category));
        ClientPlayConnectionEvents.JOIN.register((handler, sender, client) -> {
            joined = true; prompted = false; worldKey = null; joinTicks = 0; retryAt = 0;
        });
        ClientPlayConnectionEvents.DISCONNECT.register((handler, client) -> {
            joined = false; worldKey = null; prompted = false; retryAt = 0;
        });
        ClientTickEvents.END_CLIENT_TICK.register(this::tick);
        ClientLifecycleEvents.CLIENT_STOPPING.register(client -> bridge.close());
        ScreenEvents.AFTER_INIT.register((client, screen, width, height) -> {
            if (screen instanceof PauseScreen pause && pause.showsPauseMenu()) {
                Screens.getWidgets(screen).add(Button.builder(Component.literal("LLM 도우미 선택하기"), b -> open(screen))
                    .bounds(6, 6, 150, 20).build());
            } else if (screen instanceof TitleScreen) {
                Screens.getWidgets(screen).add(Button.builder(Component.literal("LLM 도우미"), b -> open(screen))
                    .bounds(6, 6, 100, 20).build());
            }
        });
        LOGGER.info("Companion selector loaded with {} characters", characters.size());
    }
    private void tick(Minecraft client) {
        if (Boolean.getBoolean("companion.selectorPreview") && !previewOpened &&
            client.gui.screen() instanceof TitleScreen && client.gui.overlay() == null) {
            previewOpened = true; open(client.gui.screen());
        }
        if (!joined || client.level == null || client.player == null) return;
        if (worldKey == null) resolveWorld(client);
        while (selectorKey.consumeClick()) if (client.gui.screen() == null) open(null);
        if (++joinTicks >= 20 && !prompted && client.gui.screen() == null && client.player.isAlive()) {
            prompted = true;
            if (memory.shouldPrompt(worldKey)) open(null);
        }
        if (System.currentTimeMillis() >= retryAt) sync();
    }
    private void resolveWorld(Minecraft client) {
        var integrated = client.getSingleplayerServer();
        if (integrated != null) {
            var root = integrated.getWorldPath(LevelResource.ROOT).toAbsolutePath().normalize();
            worldKey = WorldMemory.key("singleplayer:" + root);
            worldLabel = integrated.getWorldData().getLevelName();
        } else if (client.getCurrentServer() != null) {
            var server = client.getCurrentServer();
            worldKey = WorldMemory.key("server:" + server.ip.trim().toLowerCase(java.util.Locale.ROOT));
            worldLabel = server.name;
        } else {
            worldKey = WorldMemory.key("connection:" + client.getConnection().getConnection().getRemoteAddress());
            worldLabel = "현재 월드";
        }
        bridgeNote = "월드별 선택은 이 기기에 저장됩니다.";
    }
    private String serverAddress() {
        var client = Minecraft.getInstance();
        var integrated = client.getSingleplayerServer();
        if (integrated != null) return integrated.isPublished() ? "127.0.0.1:" + integrated.getPort() : null;
        return client.getCurrentServer() == null ? null : client.getCurrentServer().ip;
    }
    public void sync() {
        if (worldKey == null || syncing) return;
        String id = memory.selected(worldKey);
        if (id == null) return;
        syncing = true; retryAt = System.currentTimeMillis() + 10000;
        String requestedWorld = worldKey;
        bridge.sync(memory.runtimeDirectory(), requestedWorld, id, serverAddress(), result -> Minecraft.getInstance().execute(() -> {
            syncing = false;
            if (requestedWorld.equals(worldKey) && id.equals(memory.selected(worldKey))) {
                bridgeNote = result.note();
                retryAt = System.currentTimeMillis() + (result.ok() ? 30000 : 10000);
            } else retryAt = 0;
        }));
    }
    public void select(String id) throws java.io.IOException {
        memory.remember(worldKey, id); prompted = true; retryAt = 0;
        bridgeNote = "선택을 저장했습니다. H 키로 다시 고를 수 있습니다.";
        sync();
    }
    public void later() throws java.io.IOException {
        if (worldKey != null && memory.shouldPrompt(worldKey)) memory.remember(worldKey, null);
        prompted = true;
    }
    public void open(Screen parent) { Minecraft.getInstance().gui.setScreen(new SelectorScreen(this, parent)); }
}
