package local.companion;

import com.google.gson.*;
import java.io.IOException;
import java.net.URI;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.Duration;
import java.util.concurrent.*;
import java.util.function.Consumer;

/** Authenticated loopback requests off the game's render/tick thread. */
public final class LocalBridge {
    public record Result(boolean ok, String note) {}
    private final ExecutorService executor = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "companion-local-bridge"); t.setDaemon(true); return t;
    });
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2))
        .followRedirects(HttpClient.Redirect.NEVER).build();
    public static URI localEndpoint(String value) {
        URI uri = URI.create(value);
        if (!"http".equals(uri.getScheme()) ||
            !("127.0.0.1".equals(uri.getHost()) || "localhost".equals(uri.getHost())) ||
            uri.getPort() < 1 || uri.getPort() > 65535 || uri.getUserInfo() != null ||
            uri.getQuery() != null || uri.getFragment() != null ||
            !(uri.getPath().isEmpty() || uri.getPath().equals("/")))
            throw new IllegalArgumentException("Only a local companion endpoint is accepted");
        return uri.resolve("/call");
    }
    public void sync(String runtimeDirectory, String worldKey, String characterId, String serverAddress, Consumer<Result> completion) {
        executor.execute(() -> {
            Result result;
            try {
                if (runtimeDirectory.isBlank()) {
                    completion.accept(new Result(false, "선택은 저장됩니다. 연결 설정에서 도우미 폴더를 지정해 주세요.")); return;
                }
                Path directory = Path.of(runtimeDirectory);
                if (!directory.isAbsolute()) throw new IOException("An absolute runtime path is required");
                // Accept either the companion project folder or its runtime subfolder.
                if (Files.isDirectory(directory.resolve("runtime"))) directory = directory.resolve("runtime");
                String token = Files.readString(directory.resolve("api-token")).trim();
                if (!token.matches("[a-fA-F0-9]{64}")) throw new IOException("Invalid local credential");
                var endpoint = JsonParser.parseString(Files.readString(directory.resolve("endpoint.json"))).getAsJsonObject();
                URI uri = localEndpoint(endpoint.get("url").getAsString());
                var args = new JsonObject();
                args.addProperty("characterId", characterId); args.addProperty("worldKey", worldKey);
                args.addProperty("serverAddress", serverAddress);
                var body = new JsonObject(); body.addProperty("name", "minecraft_select_helper"); body.add("arguments", args);
                var request = HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(3))
                    .header("Authorization", "Bearer " + token).header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(body.toString(), StandardCharsets.UTF_8)).build();
                var response = http.send(request, HttpResponse.BodyHandlers.ofInputStream());
                String text;
                try (var stream = response.body()) {
                    byte[] bytes = stream.readNBytes(131073);
                    if (bytes.length > 131072) throw new IOException("Oversized bridge response");
                    text = new String(bytes, StandardCharsets.UTF_8);
                }
                if (response.statusCode() == 401) result = new Result(false, "연결 인증이 바뀌었습니다. 도우미 폴더 설정을 확인해 주세요.");
                else if (response.statusCode() != 200) result = new Result(false,
                    text.contains("WORLD_MISMATCH") ? "선택은 저장되었습니다. 도우미가 다른 월드에 연결되어 있습니다." : "선택은 저장되었습니다. 도우미 실행기를 업데이트해 주세요.");
                else {
                    var payload = JsonParser.parseString(text).getAsJsonObject().getAsJsonObject("result");
                    boolean enabled = payload.get("controllerEnabled").getAsBoolean();
                    result = new Result(true, enabled ? "연결되었습니다. 선택한 성격이 다음 대화부터 반영됩니다." : "선택을 전달했습니다. LLM을 켜면 이 성격으로 대화합니다.");
                }
            } catch (Exception e) {
                if (e instanceof InterruptedException) Thread.currentThread().interrupt();
                result = new Result(false, "선택은 저장됩니다. 도우미 실행기와 연결을 기다리고 있습니다.");
            }
            completion.accept(result);
        });
    }
    public void close() { executor.shutdownNow(); http.close(); }
}
