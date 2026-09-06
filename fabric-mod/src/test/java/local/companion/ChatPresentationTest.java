package local.companion;

import static org.junit.jupiter.api.Assertions.*;
import java.util.List;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.contents.TranslatableContents;
import org.junit.jupiter.api.Test;

class ChatPresentationTest {
    @Test void everyCharacterReplacesAccountNameAndRemovesItsTransportLabel() {
        for (String name : List.of("얀로롱", "지피짱", "도로롱", "젬짱", "스피키")) {
            var original = Component.translatable("chat.type.text", Component.literal("CompanionBot"), Component.literal("[" + name + "] 안녕하세요."));
            var shown = ChatPresentation.forCompanion(original, name);
            var args = ((TranslatableContents) shown.getContents()).getArgs();
            assertEquals(name, ((Component) args[0]).getString());
            assertEquals("안녕하세요.", ((Component) args[1]).getString());
            assertEquals("CompanionBot", ((Component) ((TranslatableContents) original.getContents()).getArgs()[0]).getString());
        }
    }
    @Test void delayedCharacterLabelAndFilteredContentStayCorrect() {
        var original = Component.translatable("chat.type.text", Component.literal("CompanionBot"), Component.literal("[도로롱] 도로!"));
        var args = ((TranslatableContents) ChatPresentation.forCompanion(original, "얀로롱").getContents()).getArgs();
        assertEquals("도로롱", ((Component) args[0]).getString());
        assertEquals("도로!", ((Component) args[1]).getString());
        var filtered = Component.translatable("chat.type.text", Component.literal("CompanionBot"), Component.literal("[봇] ###"));
        var filteredArgs = ((TranslatableContents) ChatPresentation.forCompanion(filtered, "얀로롱").getContents()).getArgs();
        assertEquals("###", ((Component) filteredArgs[1]).getString());
    }
    @Test void arbitraryTextAndUnknownBindingsAreNotRewritten() {
        var plain = Component.literal("<CompanionBot> [도로롱] 도로!");
        assertSame(plain, ChatPresentation.forCompanion(plain, "도로롱"));
        var chat = Component.translatable("chat.type.text", Component.literal("OtherPlayer"), Component.literal("hello"));
        assertSame(chat, ChatPresentation.forCompanion(chat, "unknown"));
    }
}
