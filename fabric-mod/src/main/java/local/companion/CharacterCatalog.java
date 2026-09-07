package local.companion;

import com.google.gson.Gson;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Objects;
import net.minecraft.core.ClientAsset;
import net.minecraft.resources.Identifier;
import net.minecraft.world.entity.player.PlayerModelType;
import net.minecraft.world.entity.player.PlayerSkin;

public final class CharacterCatalog {
    public record Character(String id, String name, String tagline, String description, String greeting, String color) {
        public int accent() { return 0xff000000 | Integer.parseInt(color.substring(1), 16); }
        public PlayerSkin playerSkin() {
            var texture = new ClientAsset.ResourceTexture(
                Identifier.fromNamespaceAndPath("companion", "skins/" + id),
                Identifier.fromNamespaceAndPath("companion", "textures/skins/" + id + ".png"));
            return new PlayerSkin(texture, null, null, PlayerModelType.WIDE, false);
        }
    }
    private record Document(List<Character> characters) {}
    public static List<Character> load() {
        try (var input = Objects.requireNonNull(CharacterCatalog.class.getResourceAsStream("/assets/companion/characters.json"));
             var reader = new InputStreamReader(input, StandardCharsets.UTF_8)) {
            var result = new Gson().fromJson(reader, Document.class).characters();
            if (result.isEmpty() || result.stream().map(Character::id).distinct().count() != result.size())
                throw new IllegalStateException("Expected distinct companion characters");
            return List.copyOf(result);
        } catch (Exception e) { throw new IllegalStateException("Cannot read companion character pack", e); }
    }
    private CharacterCatalog() {}
}
