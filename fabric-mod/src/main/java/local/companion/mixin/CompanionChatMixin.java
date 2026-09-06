package local.companion.mixin;

import com.mojang.authlib.GameProfile;
import java.time.Instant;
import local.companion.ChatPresentation;
import local.companion.CompanionClient;
import net.minecraft.client.gui.components.ChatComponent;
import net.minecraft.client.multiplayer.chat.ChatListener;
import net.minecraft.client.multiplayer.chat.GuiMessageTag;
import net.minecraft.network.chat.ChatType;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.MessageSignature;
import net.minecraft.network.chat.PlayerChatMessage;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Redirect;

@Mixin(ChatListener.class)
public abstract class CompanionChatMixin {
    @Redirect(method = "showMessageToPlayer", at = @At(value = "INVOKE", target =
        "Lnet/minecraft/client/gui/components/ChatComponent;addPlayerMessage(Lnet/minecraft/network/chat/Component;Lnet/minecraft/network/chat/MessageSignature;Lnet/minecraft/client/multiplayer/chat/GuiMessageTag;)V"))
    private void companionChatName(ChatComponent chat, Component shown, MessageSignature signature, GuiMessageTag tag,
            ChatType.Bound bound, PlayerChatMessage message, Component decorated, GameProfile sender,
            boolean secureOnly, Instant receivedAt) {
        var character = sender != null && sender.id().equals(message.sender())
            ? CompanionClient.appearanceFor(sender.id()) : null;
        // This runs after vanilla block/filter/trust decisions. Signature, sender
        // identity and chat-report records stay intact; only the displayed text changes.
        chat.addPlayerMessage(character == null ? shown : ChatPresentation.forCompanion(shown, character.name()), signature, tag);
    }
}
