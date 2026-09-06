package local.companion.mixin;
import local.companion.VisionCapture;
import net.minecraft.client.DeltaTracker;
import net.minecraft.client.renderer.GameRenderer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
@Mixin(GameRenderer.class)
public abstract class CompanionVisionMixin {
    @Inject(method = "extract", at = @At("HEAD"))
    private void companion$vision(DeltaTracker delta, boolean renderLevel, CallbackInfo ci) {
        VisionCapture.INSTANCE.renderNext((GameRenderer) (Object) this, delta, renderLevel);
    }
}
