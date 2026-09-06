package local.companion;

import static org.junit.jupiter.api.Assertions.*;
import java.nio.file.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class WorldMemoryTest {
    @TempDir Path directory;
    @Test void newAndExistingWorldsPromptOnceAndKeepSeparateSelections() throws Exception {
        Path file = directory.resolve("companion-selector.json");
        String a = WorldMemory.key("singleplayer:/saves/already-existing");
        String b = WorldMemory.key("singleplayer:/saves/new");
        var memory = new WorldMemory(file);
        assertTrue(memory.shouldPrompt(a));
        assertTrue(memory.shouldPrompt(b));
        memory.remember(a, "doro"); memory.remember(b, "spiki");
        var restored = new WorldMemory(file);
        assertFalse(restored.shouldPrompt(a));
        assertEquals("doro", restored.selected(a));
        assertEquals("spiki", restored.selected(b));
        restored.remember(a, "gemchan");
        assertEquals("gemchan", new WorldMemory(file).selected(a));
        assertEquals("spiki", new WorldMemory(file).selected(b));
    }
    @Test void laterDoesNotRepeatedlyInterruptButCanBeReplaced() throws Exception {
        var memory = new WorldMemory(directory.resolve("config.json"));
        String world = WorldMemory.key("server:example.invalid:25565");
        memory.remember(world, null);
        assertFalse(memory.shouldPrompt(world));
        assertNull(memory.selected(world));
        memory.remember(world, "gpchan");
        assertEquals("gpchan", memory.selected(world));
    }
    @Test void rejectsUnknownCharactersAndPreservesMalformedConfig() throws Exception {
        Path file = directory.resolve("config.json");
        Files.writeString(file, "{malformed config");
        var memory = new WorldMemory(file);
        try (var files = Files.list(directory)) {
            assertEquals(1, files.filter(p -> p.getFileName().toString().startsWith("config.json.invalid-")).count());
        }
        assertThrows(IllegalArgumentException.class, () -> memory.remember(WorldMemory.key("world"), "../../outside"));
        assertThrows(IllegalArgumentException.class, () -> memory.remember("../world", "doro"));
    }
}
