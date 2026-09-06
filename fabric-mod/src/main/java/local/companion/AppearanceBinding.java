package local.companion;

import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/** Only a bot UUID returned by the authenticated, world-checked bridge is themed. */
public final class AppearanceBinding {
    private static final Set<String> IDS = Set.of("yanro", "gpchan", "doro", "gemchan", "spiki");
    private String world, character;
    private UUID bot;
    private long expires;

    public void clear() { world = null; character = null; bot = null; expires = 0; }
    public void update(String world, String character, String uuid, long now) {
        clear();
        if (world == null || character == null || !IDS.contains(character) || uuid == null) return;
        try { bot = UUID.fromString(uuid); } catch (IllegalArgumentException e) { return; }
        this.world = world; this.character = character; expires = now + 40000;
    }
    public String characterFor(String currentWorld, UUID entity, long now) {
        return bot != null && bot.equals(entity) && Objects.equals(world, currentWorld) && now < expires ? character : null;
    }
}
