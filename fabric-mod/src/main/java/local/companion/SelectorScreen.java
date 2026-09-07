package local.companion;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.components.PlayerSkinWidget;
import net.minecraft.client.gui.components.Tooltip;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;

public final class SelectorScreen extends Screen {
    private final CompanionClient companion;
    private final Screen parent;
    private final List<CharacterCard> cards = new ArrayList<>();
    private int selected;
    private int left, contentWidth, cardBottom;
    private String error;
    public SelectorScreen(CompanionClient companion, Screen parent) {
        super(Component.literal("LLM 도우미 선택하기"));
        this.companion = companion; this.parent = parent;
        String saved = companion.worldKey == null ? null : companion.memory.selected(companion.worldKey);
        for (int i = 0; i < companion.characters.size(); i++) if (companion.characters.get(i).id().equals(saved)) selected = i;
    }
    @Override protected void init() {
        cards.clear();
        int count = companion.characters.size();
        contentWidth = Math.min(Math.min(900, width - 24), count * 155 + (count - 1) * 5); left = (width - contentWidth) / 2;
        int gap = 5, cardWidth = (contentWidth - gap * (count - 1)) / count;
        int cardHeight = Math.max(74, Math.min(192, height - 158));
        int top = Math.max(50, (height - (cardHeight + 144)) / 2 + 50);
        cardBottom = top + cardHeight;
        for (int i = 0; i < companion.characters.size(); i++) {
            var card = new CharacterCard(i, left + i * (cardWidth + gap), top, cardWidth, cardHeight);
            cards.add(addRenderableWidget(card));
        }
        int buttonWidth = Math.min(180, (contentWidth - 10) / 2);
        var confirm = addRenderableWidget(Button.builder(Component.literal(companion.worldKey == null ? "월드에 들어가면 선택할 수 있습니다" : "이 도우미와 함께하기"), b -> confirm())
            .bounds(width / 2 - buttonWidth - 3, height - 48, buttonWidth, 20).build());
        confirm.active = companion.worldKey != null;
        addRenderableWidget(Button.builder(Component.literal(companion.worldKey == null ? "돌아가기" : "나중에 선택하기"), b -> onClose())
            .bounds(width / 2 + 3, height - 48, buttonWidth, 20).build());
        addRenderableWidget(Button.builder(Component.literal("연결 설정"), b -> minecraft.gui.setScreen(new BridgeSettingsScreen(companion, this)))
            .bounds(6, 5, 70, 20).build());
        setInitialFocus(cards.get(selected));
    }
    private void confirm() {
        if (companion.worldKey == null) return;
        try {
            var c = companion.characters.get(selected);
            companion.select(c.id());
            minecraft.gui.setScreen(parent);
            // A local notification is not a chat message to other players or an LLM request.
            minecraft.gui.hud.setOverlayMessage(Component.literal(c.name() + " 선택 완료 · H 키로 다시 선택"), false);
        } catch (Exception e) { error = "선택을 저장하지 못했습니다. 설정 폴더를 확인해 주세요."; }
    }
    @Override public void onClose() {
        try { companion.later(); minecraft.gui.setScreen(parent); }
        catch (Exception e) { error = "설정을 저장하지 못했습니다. 다시 시도해 주세요."; }
    }
    @Override public boolean isPauseScreen() { return true; }
    @Override public void extractRenderState(GuiGraphicsExtractor graphics, int mouseX, int mouseY, float delta) {
        super.extractRenderState(graphics, mouseX, mouseY, delta);
        graphics.centeredText(font, title, width / 2, 17, 0xfff3f2e9);
        graphics.centeredText(font, "함께할 친구를 골라 주세요", width / 2, 34, 0xffa9d58c);
        var c = companion.characters.get(selected);
        graphics.text(font, c.name() + "  ·  " + c.tagline(), left + 3, cardBottom + 9, c.accent());
        var lines = font.split(Component.literal(c.greeting()), contentWidth - 6);
        for (int i = 0; i < Math.min(2, lines.size()); i++) graphics.text(font, lines.get(i), left + 3, cardBottom + 24 + i * 10, 0xffd2d2c9);
        String footer = error != null ? error : (companion.worldKey == null ? "미리보기 · 월드 진입 시 처음 한 번 표시됩니다" : "선택은 이 월드에 저장됩니다 · H 키로 다시 선택");
        graphics.centeredText(font, footer, width / 2, height - 19, error == null ? 0xffaaa99f : 0xffff9292);
    }
    @Override public void extractBackground(GuiGraphicsExtractor graphics, int mouseX, int mouseY, float delta) {
        super.extractBackground(graphics, mouseX, mouseY, delta);
        graphics.fillGradient(0, 0, width, height, 0xe5151a17, 0xf00e110f);
        graphics.fill(0, 0, width, 2, 0xff71984c);
        graphics.fill(0, height - 2, width, height, 0xff435d31);
    }
    private final class CharacterCard extends Button {
        private final int index;
        private final PlayerSkinWidget skin;
        private final CharacterCatalog.Character character;
        CharacterCard(int index, int x, int y, int width, int height) {
            super(x, y, width, height, Component.literal(companion.characters.get(index).name()),
                b -> { selected = index; error = null; }, DEFAULT_NARRATION);
            this.index = index; this.character = companion.characters.get(index);
            this.skin = new PlayerSkinWidget(width - 6, height - 29, minecraft.getEntityModels(), character::playerSkin);
            skin.setX(x + 3); skin.setY(y + 6);
            setTooltip(Tooltip.create(Component.literal(character.name() + " · " + character.tagline() + "\n" + character.description())));
            setTooltipDelay(Duration.ofMillis(180));
        }
        @Override protected void extractContents(GuiGraphicsExtractor graphics, int mouseX, int mouseY, float delta) {
            boolean chosen = selected == index;
            int x = getX(), y = getY(), right = getRight(), bottom = getBottom();
            int border = chosen ? character.accent() : isHoveredOrFocused() ? 0xffeeeecc : 0xff555f50;
            graphics.fill(x + 2, y + 2, right + 2, bottom + 2, 0xff080b08);
            graphics.fill(x, y, right, bottom, border);
            graphics.fillGradient(x + 2, y + 2, right - 2, bottom - 2, chosen ? 0xff3b4636 : 0xff30392e, 0xff171e18);
            graphics.fill(x + 3, y + 3, right - 3, y + 4, 0x508e9c80);
            graphics.fill(x + 4, bottom - 21, right - 4, bottom - 20, 0xff58634e);
            skin.extractRenderState(graphics, mouseX, mouseY, delta);
            graphics.centeredText(font, character.name(), x + width / 2, bottom - 14, chosen ? character.accent() : 0xffdeded0);
            if (chosen) {
                graphics.fill(right - 11, y + 5, right - 5, y + 11, character.accent());
                graphics.fill(right - 9, y + 7, right - 7, y + 9, 0xff213018);
            }
        }
    }
}
