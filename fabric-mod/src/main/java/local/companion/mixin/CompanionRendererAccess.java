package local.companion.mixin;
import com.mojang.blaze3d.pipeline.RenderTarget;
import net.minecraft.client.renderer.GameRenderer;
import net.minecraft.client.renderer.GlobalSettingsUniform;
import net.minecraft.client.renderer.Lightmap;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Mutable;
import org.spongepowered.asm.mixin.gen.Accessor;
@Mixin(GameRenderer.class)
public interface CompanionRendererAccess {
    @Mutable @Accessor("mainRenderTarget") void companion$setTarget(RenderTarget target);
    @Accessor("renderBlockOutline") boolean companion$getOutline();
    @Accessor("globalSettingsUniform") GlobalSettingsUniform companion$globals();
    @Accessor("lightmap") Lightmap companion$lightmap();
}
