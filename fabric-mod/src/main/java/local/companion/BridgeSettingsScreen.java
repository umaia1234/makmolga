package local.companion;

import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;
import java.nio.file.Files;
import java.nio.file.Path;

public final class BridgeSettingsScreen extends Screen {
    private final CompanionClient companion;
    private final Screen parent;
    private EditBox folder;
    private String error;
    private String draft;
    private int left, formWidth, top;
    public BridgeSettingsScreen(CompanionClient companion, Screen parent) {
        super(Component.literal("LLM 도우미 연결 설정"));
        this.companion = companion; this.parent = parent;
        draft = companion.memory.runtimeDirectory();
    }
    @Override protected void init() {
        formWidth = Math.min(480, width - 40); left = (width - formWidth) / 2; top = Math.max(56, height / 2 - 42);
        folder = new EditBox(font, left, top + 17, formWidth, 20, Component.literal("Minecraft Companion 폴더의 전체 경로"));
        folder.setMaxLength(1024); folder.setValue(draft); folder.setResponder(value -> draft = value);
        folder.setHint(Component.literal("예: C:/Minecraft/minecraft-companion"));
        addRenderableWidget(folder);
        addRenderableWidget(Button.builder(Component.literal("동료 자동 연결 센터 열기 ↗"), b -> openConnections())
            .bounds(left, top - 29, Math.min(formWidth, 220), 20).build());
        addRenderableWidget(Button.builder(Component.literal("저장하고 돌아가기"), b -> {
            try { companion.memory.runtimeDirectory(folder.getValue()); companion.sync(); onClose(); }
            catch (Exception e) { error = "설정을 저장하지 못했습니다."; }
        }).bounds(width / 2 - 153, height - 45, 150, 20).build());
        addRenderableWidget(Button.builder(Component.literal("취소"), b -> onClose()).bounds(width / 2 + 3, height - 45, 150, 20).build());
        setInitialFocus(folder);
    }
    private void openConnections() {
        try {
            Path root = Path.of(folder.getValue().trim());
            if (!root.isAbsolute()) throw new IllegalArgumentException("Absolute path required");
            if (root.getFileName().toString().equals("runtime")) root = root.getParent();
            Path script = root.resolve("Connect-Companions.ps1");
            if (!Files.isRegularFile(script)) { error = "맠몰가 폴더를 먼저 지정해 주세요. Connect-Companions.ps1이 필요합니다."; return; }
            new ProcessBuilder("powershell.exe", "-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", script.toString())
                .directory(root.toFile()).redirectOutput(ProcessBuilder.Redirect.DISCARD).redirectError(ProcessBuilder.Redirect.DISCARD).start();
            error = "브라우저에서 동료 연결 센터를 열고 있습니다.";
        } catch (Exception e) { error = "연결 센터를 열지 못했습니다. 맠몰가 폴더의 Connect-Companions.ps1을 실행해 주세요."; }
    }
    @Override public void onClose() { minecraft.gui.setScreen(parent); }
    @Override public void extractRenderState(GuiGraphicsExtractor graphics, int mouseX, int mouseY, float delta) {
        super.extractRenderState(graphics, mouseX, mouseY, delta);
        graphics.centeredText(font, title, width / 2, 22, 0xfff3f2e9);
        graphics.text(font, "도우미 프로그램이 있는 폴더", left, top, 0xffbad5a0);
        graphics.textWithWordWrap(font, Component.literal("이 PC에서 실행한 Minecraft Companion에 연결합니다. 폴더 안의 연결 정보를 자동으로 읽습니다. 비워 두면 캐릭터 선택만 사용할 수 있습니다."), left, top + 48, formWidth, 0xffd2d2c9);
        graphics.textWithWordWrap(font, Component.literal(error == null ? companion.bridgeNote : error), left, top + 86, formWidth, error == null ? 0xffb9caa6 : 0xffff9292);
    }
}
