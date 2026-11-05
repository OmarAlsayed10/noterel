import { NativeModule, requireNativeModule } from 'expo'

declare class KestrelDeviceCodeModule extends NativeModule {
  show(code: string): Promise<void>
  dismiss(): Promise<void>
}

export default requireNativeModule<KestrelDeviceCodeModule>('KestrelDeviceCode')
