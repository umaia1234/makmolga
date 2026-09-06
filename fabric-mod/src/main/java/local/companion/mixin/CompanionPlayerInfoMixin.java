package local.companion.mixin;

import com.mojang.authlib.GameProfile;
import local.companion.CompanionClient;
import net.minecraft.client.multiplayer.PlayerInfo;
import net.minecraft.network.chat.Component;
import net.minecraft.world.entity.player.PlayerSkin;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(PlayerInfo.class)
public abstract class CompanionPlayerInfoMixin {
    @Shadow public abstract GameProfile getProfile();

    @Inject(method = "getSkin", at = @At("HEAD"), cancellable = true)
    private void companionSkin(CallbackInfoReturnable<PlayerSkin> result) {
        var character = CompanionClient.appearanceFor(getProfile().id());
        if (character != null) result.setReturnValue(character.playerSkin());
    }

    @Inject(method = "getTabListDisplayName", at = @At("HEAD"), cancellable = true)
    private void companionTabName(CallbackInfoReturnable<Component> result) {
        var character = CompanionClient.appearanceFor(getProfile().id());
        if (character != null) result.setReturnValue(Component.literal(character.name()));
    }
}
