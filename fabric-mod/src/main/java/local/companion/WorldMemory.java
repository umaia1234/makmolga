package local.companion;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;

/** Client preferences only: never opens or rewrites a Minecraft world save. */
public final class WorldMemory {
    private static final Gson JSON = new GsonBuilder().setPrettyPrinting().create();
    private static final Set<String> IDS = Set.of("yanro", "gpchan", "doro", "gemchan", "spiki", "clchan", "fablechan");
    public record Selection(String characterId, boolean deferred) {}
    private static final class Document {
        int schemaVersion = 1;
        String runtimeDirectory = "";
        Map<String, Selection> worlds = new LinkedHashMap<>();
    }
    private final Path file;
    private Document document;
    private Set<String> availableIds = IDS;
    public WorldMemory(Path file) throws IOException {
        this.file = file;
        try {
            document = Files.exists(file) ? JSON.fromJson(Files.readString(file), Document.class) : new Document();
            if (document == null || document.schemaVersion != 1 || document.worlds == null || document.runtimeDirectory == null)
                throw new IllegalArgumentException("Invalid preferences");
            document.worlds.entrySet().removeIf(e -> e.getValue() == null ||
                (e.getValue().characterId() != null && !IDS.contains(e.getValue().characterId())));
        } catch (RuntimeException e) {
            // Preserve malformed user data before creating a fresh preferences file.
            Files.copy(file, file.resolveSibling(file.getFileName() + ".invalid-" + System.currentTimeMillis()));
            document = new Document();
        }
    }
    public static String key(String source) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(source.getBytes(StandardCharsets.UTF_8))); }
        catch (Exception e) { throw new IllegalStateException(e); }
    }
    public void availableCharacters(Set<String> ids) { availableIds = Set.copyOf(ids); }
    public boolean shouldPrompt(String key) { var s = document.worlds.get(key); return s == null || (s.characterId() != null && !availableIds.contains(s.characterId())); }
    public String selected(String key) {
        var s = document.worlds.get(key);
        return s == null || s.characterId() == null || !availableIds.contains(s.characterId()) ? null : s.characterId();
    }
    public String runtimeDirectory() { return document.runtimeDirectory; }
    public void runtimeDirectory(String value) throws IOException {
        String previous = document.runtimeDirectory;
        document.runtimeDirectory = value.trim();
        try { save(); } catch (IOException e) { document.runtimeDirectory = previous; throw e; }
    }
    public void remember(String key, String characterId) throws IOException {
        if (key == null || !key.matches("[a-f0-9]{64}")) throw new IllegalArgumentException("Invalid world key");
        if (characterId != null && !availableIds.contains(characterId)) throw new IllegalArgumentException("Invalid character");
        var previous = document.worlds.put(key, new Selection(characterId, characterId == null));
        try { save(); }
        catch (IOException e) { if (previous == null) document.worlds.remove(key); else document.worlds.put(key, previous); throw e; }
    }
    private void save() throws IOException {
        Files.createDirectories(file.toAbsolutePath().getParent());
        Path temp = file.resolveSibling(file.getFileName() + ".tmp");
        Files.writeString(temp, JSON.toJson(document) + "\n", StandardCharsets.UTF_8);
        try { Files.move(temp, file, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING); }
        catch (AtomicMoveNotSupportedException e) { Files.move(temp, file, StandardCopyOption.REPLACE_EXISTING); }
    }
}
