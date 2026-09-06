package local.companion.mixin;

import local.companion.CompanionClient;
import net.minecraft.client.renderer.entity.EntityRenderer;
import net.minecraft.network.chat.Component;
import net.minecraft.world.entity.Entity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(EntityRenderer.class)
public abstract class CompanionNameTagMixin {
    @Inject(method = "getNameTag", at = @At("HEAD"), cancellable = true)
    private void companionName(Entity entity, CallbackInfoReturnable<Component> result) {
        var character = CompanionClient.appearanceFor(entity.getUUID());
        if (character != null) result.setReturnValue(Component.literal(character.name()));
    }
}
