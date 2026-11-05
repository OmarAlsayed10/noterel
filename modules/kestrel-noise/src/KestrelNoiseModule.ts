import { NativeModule, requireNativeModule } from 'expo'

declare class KestrelNoiseModule extends NativeModule {
  execute(command: string): Promise<string>
}

export default requireNativeModule<KestrelNoiseModule>('KestrelNoise')
