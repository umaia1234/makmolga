package local.companion;

import static org.junit.jupiter.api.Assertions.*;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class AppearanceBindingTest {
    private final UUID bot = UUID.fromString("f7f02df9-b8bd-3a3c-9575-c5267bb66ce3");
    @Test void onlyConfirmedBotInTheCurrentWorldChangesAppearance() {
        var binding = new AppearanceBinding();
        binding.update("server-a", "gpchan", bot.toString(), 1000);
        assertEquals("gpchan", binding.characterFor("server-a", bot, 1100));
        assertNull(binding.characterFor("server-b", bot, 1100));
        assertNull(binding.characterFor("server-a", UUID.randomUUID(), 1100));
        assertNull(binding.characterFor("server-a", bot, 41000));
        binding.update("server-a", "doro", bot.toString(), 50000);
        assertEquals("doro", binding.characterFor("server-a", bot, 50001));
        binding.clear();
        assertNull(binding.characterFor("server-a", bot, 50002));
    }
    @Test void DisconnectedOrInvalidBridgeIdentityRemovesAnOldBinding() {
        var binding = new AppearanceBinding();
        for (String uuid : new String[]{null, "not-a-uuid"}) {
            binding.update("a", "gpchan", bot.toString(), 100);
            binding.update("a", "gpchan", uuid, 101);
            assertNull(binding.characterFor("a", bot, 102));
        }
        binding.update("a", "missing", bot.toString(), 100);
        assertNull(binding.characterFor("a", bot, 101));
    }
}
