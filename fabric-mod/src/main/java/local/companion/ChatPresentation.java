package local.companion;

import java.util.Set;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.contents.TranslatableContents;

/** Presentation only: callers must first verify the sender's UUID with the local bridge. */
public final class ChatPresentation {
    private static final Set<String> NAMES = Set.of("얀로롱", "지피짱", "도로롱", "젬짱", "스피키", "클짱", "페짱");

    public static Component forCompanion(Component shown, String selectedName) {
        if (!NAMES.contains(selectedName) || !(shown.getContents() instanceof TranslatableContents text)
                || !text.getKey().equals("chat.type.text") || text.getArgs().length != 2) return shown;
        Object[] args = text.getArgs().clone();
        if (!(args[1] instanceof Component body)) return shown;
        String plain = body.getString();
        String speaker = selectedName;
        // Each runtime line carries its original character so a delayed reply is
        // never relabelled as a newly selected character. Legacy [봇] is supported.
        for (String name : NAMES) {
            String prefix = "[" + name + "] ";
            if (plain.startsWith(prefix)) { speaker = name; plain = plain.substring(prefix.length()); break; }
        }
        if (plain.startsWith("[봇] ")) plain = plain.substring(4);
        args[0] = Component.literal(speaker);
        args[1] = plain.equals(body.getString()) ? body : Component.literal(plain).setStyle(body.getStyle());
        var result = Component.translatableWithFallback(text.getKey(), text.getFallback(), args).setStyle(shown.getStyle());
        shown.getSiblings().forEach(sibling -> result.append(sibling.copy()));
        return result;
    }

    private ChatPresentation() {}
}
