package com.kestrelbrain.noise

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

object NoiseNative {
  init {
    System.loadLibrary("kestrel_noise")
  }

  external fun execute(command: String): String
}

class KestrelNoiseModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("KestrelNoise")

    AsyncFunction("execute") { command: String ->
      NoiseNative.execute(command)
    }
  }
}
