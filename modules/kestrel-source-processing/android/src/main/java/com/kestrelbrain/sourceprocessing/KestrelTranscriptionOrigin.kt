package com.kestrelbrain.sourceprocessing

import java.io.File
import java.io.IOException
import android.util.AtomicFile
import org.json.JSONObject

fun saveTranscriptionOrigin(directory: File, originJson: String?) {
  if (originJson == null) return
  require(originJson.toByteArray(Charsets.UTF_8).size <= 8192) { "Transcription source is too large" }
  JSONObject(originJson)
  val file = AtomicFile(File(directory, "origin.json"))
  val output = file.startWrite()
  try {
    output.write(originJson.toByteArray(Charsets.UTF_8))
    file.finishWrite(output)
  } catch (error: Exception) {
    file.failWrite(output)
    throw error
  }
}

fun transcriptionOrigin(directory: File): Map<String, Any?> {
  val origin = File(directory, "origin.json")
  if (!origin.isFile && !File(directory, "origin.json.bak").isFile) return emptyMap()
  return try {
    AtomicFile(origin).openRead().use { input ->
      val buffer = ByteArray(8193)
      var size = 0
      while (size < buffer.size) {
        val read = input.read(buffer, size, buffer.size - size)
        if (read < 0) break
        size += read
      }
      if (size > 8192) mapOf("originReadError" to true)
      else mapOf("originJson" to String(buffer, 0, size, Charsets.UTF_8))
    }
  } catch (_: IOException) {
    mapOf("originReadError" to true)
  }
}
