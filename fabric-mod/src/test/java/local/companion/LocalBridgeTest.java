package local.companion;

import static org.junit.jupiter.api.Assertions.*;
import com.sun.net.httpserver.HttpServer;
import com.google.gson.JsonParser;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class LocalBridgeTest {
    @TempDir Path directory;
    @Test void onlyLoopbackCredentialsCanBeUsed() {
        assertEquals("http://127.0.0.1:1234/call", LocalBridge.localEndpoint("http://127.0.0.1:1234").toString());
        for (String bad : new String[]{"https://example.com:443", "http://localhost.evil:1234", "http://user@localhost:1234", "http://localhost:1234/?token=x", "file:///etc/passwd", "http://localhost:1234/other", "http://127.0.0.2:1234"})
            assertThrows(IllegalArgumentException.class, () -> LocalBridge.localEndpoint(bad), bad);
    }
    @Test void sendsAuthenticatedCharacterSelectionAndReportsControllerOff() throws Exception {
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        var request = new AtomicReference<String>(); var authorization = new AtomicReference<String>();
        server.createContext("/call", exchange -> {
            authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
            request.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            byte[] body = "{\"result\":{\"controllerEnabled\":false}}".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, body.length); exchange.getResponseBody().write(body); exchange.close();
        });
        server.start();
        var bridge = new LocalBridge();
        try {
            Files.writeString(directory.resolve("endpoint.json"), "{\"url\":\"http://127.0.0.1:" + server.getAddress().getPort() + "\"}");
            Files.writeString(directory.resolve("api-token"), "a".repeat(64));
            var completion = new CompletableFuture<LocalBridge.Result>();
            bridge.sync(directory.toString(), WorldMemory.key("world"), "yanro", null, completion::complete);
            var result = completion.get(5, TimeUnit.SECONDS);
            assertTrue(result.ok()); assertTrue(result.note().contains("LLM을 켜면"));
            assertEquals("Bearer " + "a".repeat(64), authorization.get());
            var payload = JsonParser.parseString(request.get()).getAsJsonObject();
            assertEquals("minecraft_select_helper", payload.get("name").getAsString());
            assertEquals("yanro", payload.getAsJsonObject("arguments").get("characterId").getAsString());
        } finally { bridge.close(); server.stop(0); }
    }
    @Test void unsetRuntimeFolderIsOfflineInsteadOfAnException() throws Exception {
        var bridge = new LocalBridge();
        try {
            var completion = new CompletableFuture<LocalBridge.Result>();
            bridge.sync("", WorldMemory.key("world"), "doro", null, completion::complete);
            assertFalse(completion.get(3, TimeUnit.SECONDS).ok());
        } finally { bridge.close(); }
    }
}
