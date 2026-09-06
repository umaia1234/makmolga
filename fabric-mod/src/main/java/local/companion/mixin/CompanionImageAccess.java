package local.companion.mixin;
import com.mojang.blaze3d.platform.NativeImage;
import java.io.IOException;
import java.nio.channels.WritableByteChannel;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Invoker;
@Mixin(NativeImage.class)
public interface CompanionImageAccess {
    @Invoker("writeToChannel") boolean companion$write(WritableByteChannel channel) throws IOException;
}
