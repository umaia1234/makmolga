package local.companion;

import com.google.gson.JsonObject;
import com.mojang.blaze3d.pipeline.TextureTarget;
import java.io.ByteArrayOutputStream;
import java.nio.channels.Channels;
import java.util.Base64;
import java.util.UUID;
import net.minecraft.client.*;
import net.minecraft.client.renderer.GameRenderer;
import local.companion.mixin.CompanionRendererAccess;
import local.companion.mixin.CompanionImageAccess;

/** Six actual world renders from the loaded bot entity, without presenting them on the player's window. */
public final class VisionCapture {
    private static final String[] DIRECTIONS = {"front", "right", "back", "left", "up", "down"};
    private static final float[] YAW = {0, 90, 180, -90, 0, 0};
    private static final float[] PITCH = {0, 0, 0, 0, -90, 90};
    public static final VisionCapture INSTANCE = new VisionCapture();
    private JsonObject request;
    private CompanionClient companion;
    private String lastId;
    private long nextPoll;
    private boolean polling, rendering;
    private int index;
    private float baseYaw;
    private TextureTarget target;

    public void tick(Minecraft client, CompanionClient owner) {
        companion = owner;
        if (client.level == null || owner.worldKey == null) { request = null; return; }
        if (polling || System.currentTimeMillis() < nextPoll) return;
        String id = owner.memory.selected(owner.worldKey);
        if (id == null || owner.memory.runtimeDirectory().isBlank()) return;
        nextPoll = System.currentTimeMillis() + 2000; polling = true;
        var args = new JsonObject(); args.addProperty("worldKey", owner.worldKey); args.addProperty("characterId", id);
        owner.bridge.exchange(owner.memory.runtimeDirectory(), "companion_vision_poll", args, result -> client.execute(() -> {
            polling = false;
            if (result == null || !result.has("request") || result.get("request").isJsonNull()) { request = null; return; }
            var candidate = result.getAsJsonObject("request");
            if (!candidate.get("worldKey").getAsString().equals(owner.worldKey)) return;
            if (candidate.get("requestId").getAsString().equals(lastId)) return;
            request = candidate; index = 0;
        }));
    }
    public void renderNext(GameRenderer renderer, DeltaTracker delta, boolean renderLevel) {
        var client = Minecraft.getInstance();
        if (rendering || !renderLevel || request == null || client.level == null || client.player == null || client.gui.screen() != null) return;
        var capture = request;
        if (System.currentTimeMillis() > capture.get("expiresAt").getAsLong() || companion == null ||
            !capture.get("worldKey").getAsString().equals(companion.worldKey) ||
            !capture.get("characterId").getAsString().equals(companion.memory.selected(companion.worldKey))) { request = null; return; }
        UUID uuid = UUID.fromString(capture.get("botUuid").getAsString());
        var bot = client.level.players().stream().filter(p -> p.getUUID().equals(uuid)).findFirst().orElse(null);
        // Missing entity means the owner is out of tracking range; never photograph the owner instead.
        if (bot == null || bot == client.player || !bot.isAlive() || CompanionClient.appearanceFor(uuid) == null) return;
        int face = index;
        if (face == 0) baseYaw = bot.getYRot();
        var camera = renderer.mainCamera(); var oldEntity = camera.entity();
        var original = renderer.mainRenderTarget(); var access = (CompanionRendererAccess) renderer;
        int width = client.getWindow().getWidth(), height = client.getWindow().getHeight();
        float yaw = bot.getYRot(), pitch = bot.getXRot(), yawOld = bot.yRotO, pitchOld = bot.xRotO;
        float headYaw = bot.yHeadRot, headYawOld = bot.yHeadRotO;
        var cameraType = client.options.getCameraType(); boolean panorama = camera.isPanoramicMode();
        boolean outline = access.companion$getOutline();
        rendering = true;
        try {
            int size = Math.clamp(capture.get("size").getAsInt(), 128, 512);
            if (target == null || target.width != size) {
                if (target != null) target.destroyBuffers();
                target = new TextureTarget("MAKMOLGA bot camera", size, size, true, original.getColorTexture().getFormat());
            }
            access.companion$setTarget(target);
            client.getWindow().setWidth(size); client.getWindow().setHeight(size);
            client.options.setCameraType(CameraType.FIRST_PERSON); renderer.setRenderBlockOutline(false);
            bot.setYRot(baseYaw + YAW[face]); bot.yRotO = bot.getYRot();
            bot.yHeadRot = bot.getYRot(); bot.yHeadRotO = bot.getYRot();
            bot.setXRot(PITCH[face]); bot.xRotO = bot.getXRot();
            camera.setEntity(bot); camera.enablePanoramicMode();
            renderer.update(DeltaTracker.ONE); renderer.extract(DeltaTracker.ONE, true);
            var state = renderer.gameRenderState(); var options = state.optionsRenderState;
            // World shaders also need the bot camera origin. Leaving the previous
            // player frame's global uniform would render blocks from the wrong position.
            access.companion$globals().update(size, size, options.glintStrength, client.level.getGameTime(), DeltaTracker.ONE,
                options.menuBackgroundBlurriness, camera.position(), options.textureFiltering == TextureFilteringMethod.RGSS);
            access.companion$lightmap().render(state.lightmapRenderState);
            com.mojang.blaze3d.systems.RenderSystem.getDevice().createCommandEncoder()
                .clearColorAndDepthTextures(target.getColorTexture(), new org.joml.Vector4f(0, 0, 0, 1), target.getDepthTexture(), 0.0);
            renderer.renderLevel(DeltaTracker.ONE);
            var args = new JsonObject();
            args.addProperty("requestId", capture.get("requestId").getAsString()); args.addProperty("worldKey", companion.worldKey);
            args.addProperty("botUuid", uuid.toString()); args.addProperty("direction", DIRECTIONS[face]);
            args.addProperty("capturedAt", System.currentTimeMillis()); args.addProperty("dimension", client.level.dimension().identifier().toString());
            var pos = new JsonObject(); pos.addProperty("x", bot.getX()); pos.addProperty("y", bot.getY()); pos.addProperty("z", bot.getZ()); args.add("position", pos);
            String directory = companion.memory.runtimeDirectory(); LocalBridge bridge = companion.bridge;
            Screenshot.takeScreenshot(target, image -> {
                try (image; var bytes = new ByteArrayOutputStream()) {
                    if (!((CompanionImageAccess) (Object) image).companion$write(Channels.newChannel(bytes))) throw new IllegalStateException("PNG encoding failed");
                    args.addProperty("png", Base64.getEncoder().encodeToString(bytes.toByteArray()));
                    bridge.exchange(directory, "companion_vision_frame", args, result -> {});
                } catch (Exception e) { CompanionClient.LOGGER.warn("Bot camera encoding failed: {}", e.toString()); }
            });
            index++;
            if (index == DIRECTIONS.length) { lastId = capture.get("requestId").getAsString(); request = null; }
        } catch (Exception e) {
            lastId = capture.get("requestId").getAsString(); request = null;
            CompanionClient.LOGGER.warn("Bot camera capture failed: {}", e.toString());
        } finally {
            // Vanilla's panorama rendering uses this same update/extract/renderLevel sequence.
            // Restore everything before the ordinary player frame is extracted and presented.
            bot.setYRot(yaw); bot.setXRot(pitch); bot.yRotO = yawOld; bot.xRotO = pitchOld;
            bot.yHeadRot = headYaw; bot.yHeadRotO = headYawOld;
            access.companion$setTarget(original); renderer.setRenderBlockOutline(outline);
            client.getWindow().setWidth(width); client.getWindow().setHeight(height);
            client.options.setCameraType(cameraType); camera.setEntity(oldEntity);
            if (!panorama) camera.disablePanoramicMode();
            renderer.update(delta); rendering = false;
        }
    }
    public void clear() { request = null; nextPoll = 0; lastId = null; }
    public void close() { clear(); if (target != null) { target.destroyBuffers(); target = null; } }
}
