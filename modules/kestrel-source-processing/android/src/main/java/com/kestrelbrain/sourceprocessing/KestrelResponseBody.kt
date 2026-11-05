package com.kestrelbrain.sourceprocessing

import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets
import okhttp3.ResponseBody

internal fun responseBytes(body: ResponseBody, maximumBytes: Int): ByteArray {
  require(body.contentLength() <= maximumBytes) { "URL response exceeds its size limit" }
  val output = ByteArrayOutputStream()
  body.byteStream().use { input ->
    val buffer = ByteArray(16 * 1024)
    while (true) {
      val read = input.read(buffer)
      if (read < 0) break
      require(output.size() + read <= maximumBytes) { "URL response exceeds its size limit" }
      output.write(buffer, 0, read)
    }
  }
  return output.toByteArray()
}

internal fun responseText(body: ResponseBody, maximumBytes: Int = 2 * 1024 * 1024): String {
  val decoder = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
  return decoder.decode(ByteBuffer.wrap(responseBytes(body, maximumBytes))).toString()
}
