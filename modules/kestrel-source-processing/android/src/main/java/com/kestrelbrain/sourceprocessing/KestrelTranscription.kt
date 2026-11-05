package com.kestrelbrain.sourceprocessing

import android.content.Context
import com.k2fsa.sherpa.onnx.OfflineModelConfig
import com.k2fsa.sherpa.onnx.OfflineRecognizer
import com.k2fsa.sherpa.onnx.OfflineRecognizerConfig
import com.k2fsa.sherpa.onnx.OfflineWhisperModelConfig
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import okhttp3.OkHttpClient
import okhttp3.Request

private const val transcriptionModelVersion = "sherpa-onnx-whisper-int8-v1"
private val transcriptionClient = OkHttpClient.Builder().connectTimeout(20, TimeUnit.SECONDS).readTimeout(5, TimeUnit.MINUTES).build()
private val transcriptionModels = mapOf(
  "small" to listOf(
    listOf("small-encoder.int8.onnx", "112442483", "4cbe7b22fa9026b843b60a68640c747de05bafb1a11b57edc0e66c232d9f33a9"),
    listOf("small-decoder.int8.onnx", "262226114", "acad50b5c782696e91b55914cc5ab4f756f1532f76e22aa6fc615f39fb69a8ee"),
    listOf("small-tokens.txt", "816730", "b34b360dbb493e781e479794586d661700670d65564001f23024971d1f2fa126")
  ),
  "medium" to listOf(
    listOf("medium-encoder.int8.onnx", "374196283", "1c54582b4d829de0089f6cb63bbbdb3bf7555398bacaf855fbecf1a84dfd193e"),
    listOf("medium-decoder.int8.onnx", "571059257", "595d00a338a365a7bfa0ca7f296cabc639583bef770ab6130df90f49a6412747"),
    listOf("medium-tokens.txt", "816730", "b34b360dbb493e781e479794586d661700670d65564001f23024971d1f2fa126")
  )
)
private val transcriptionRevisions = mapOf("small" to "8f3c18b358db4d1f2fc1eae49d75cd20989e4309", "medium" to "8c31d28503847560985df21f90e14f0c736e075e")

private fun transcriptionModel(model: String): List<List<String>> = requireNotNull(transcriptionModels[model]) { "Transcription model is not supported" }
private fun transcriptionDirectory(context: Context, model: String) = File(context.noBackupFilesDir, "transcription/$model")
private fun hexadecimal(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it) }

private fun fileSha256(file: File): String {
  val digest = MessageDigest.getInstance("SHA-256")
  FileInputStream(file).use { input ->
    val buffer = ByteArray(64 * 1024)
    while (true) {
      val read = input.read(buffer)
      if (read < 0) break
      digest.update(buffer, 0, read)
    }
  }
  return hexadecimal(digest.digest())
}

private fun downloadModelFile(url: String, target: File, expectedBytes: Long, expectedSha256: String, completedBytes: Long, totalBytes: Long, progress: (Long, Long) -> Unit) {
  if (target.isFile && target.length() == expectedBytes && fileSha256(target) == expectedSha256) {
    progress(completedBytes + expectedBytes, totalBytes)
    return
  }
  if (target.exists()) require(target.delete()) { "Invalid model file could not be replaced" }
  val temporary = File(target.parentFile, "${target.name}.download")
  if (temporary.length() == expectedBytes && fileSha256(temporary) == expectedSha256) {
    require(temporary.renameTo(target)) { "Model file could not be installed" }
    progress(completedBytes + expectedBytes, totalBytes)
    return
  }
  if (temporary.length() >= expectedBytes) require(temporary.delete()) { "Invalid partial model could not be replaced" }
  var offset = temporary.length()
  val request = Request.Builder().url(url).apply { if (offset > 0) header("Range", "bytes=$offset-") }.build()
  transcriptionClient.newCall(request).execute().use { response ->
    require(response.isSuccessful) { "Model download returned HTTP ${response.code}" }
    if (offset > 0 && response.code != 206) {
      require(temporary.delete()) { "Partial model could not be restarted" }
      offset = 0
    }
    val body = requireNotNull(response.body) { "Model download was empty" }
    val responseBytes = body.contentLength()
    require(responseBytes == -1L || responseBytes == expectedBytes - offset) { "Model download size is invalid" }
    val digest = MessageDigest.getInstance("SHA-256")
    if (offset > 0) FileInputStream(temporary).use { input ->
      val buffer = ByteArray(64 * 1024)
      while (true) {
        val read = input.read(buffer)
        if (read < 0) break
        digest.update(buffer, 0, read)
      }
    }
    progress(completedBytes + offset, totalBytes)
    FileOutputStream(temporary, offset > 0).use { output -> body.byteStream().use { input ->
      val buffer = ByteArray(64 * 1024)
      var total = offset
      while (true) {
        val read = input.read(buffer)
        if (read < 0) break
        total += read
        require(total <= expectedBytes) { "Model download exceeds its expected size" }
        digest.update(buffer, 0, read)
        output.write(buffer, 0, read)
        progress(completedBytes + total, totalBytes)
      }
      if (total != expectedBytes || hexadecimal(digest.digest()) != expectedSha256) {
        temporary.delete()
        throw IllegalArgumentException("Model download failed verification")
      }
    } }
  }
  require(temporary.renameTo(target)) { "Model file could not be installed" }
}

fun installedTranscriptionModels(context: Context): List<String> = transcriptionModels.keys.filter { model ->
  val marker = File(transcriptionDirectory(context, model), "installed")
  marker.isFile && marker.readText().trim() == transcriptionModelVersion && transcriptionModel(model).all { entry -> File(transcriptionDirectory(context, model), entry[0]).let { it.isFile && it.length() == entry[1].toLong() } }
}

fun transcriptionModelBytes(model: String): Long = transcriptionModel(model).sumOf { it[1].toLong() }

fun downloadTranscriptionModel(context: Context, model: String, progress: (Long, Long) -> Unit = { _, _ -> }) {
  val directory = transcriptionDirectory(context, model)
  require(directory.exists() || directory.mkdirs()) { "Transcription model storage is unavailable" }
  val revision = requireNotNull(transcriptionRevisions[model])
  val totalBytes = transcriptionModelBytes(model)
  var completedBytes = 0L
  progress(0, totalBytes)
  for (entry in transcriptionModel(model)) {
    val filename = entry[0]
    val expectedBytes = entry[1].toLong()
    val url = "https://huggingface.co/csukuangfj/sherpa-onnx-whisper-$model/resolve/$revision/$filename"
    downloadModelFile(url, File(directory, filename), expectedBytes, entry[2], completedBytes, totalBytes, progress)
    completedBytes += expectedBytes
  }
  File(directory, "installed").writeText(transcriptionModelVersion)
}

fun deleteTranscriptionModel(context: Context, model: String): Long {
  transcriptionModel(model)
  val directory = transcriptionDirectory(context, model)
  val deletedBytes = directory.walkTopDown().filter(File::isFile).sumOf(File::length)
  require(!directory.exists() || directory.deleteRecursively()) { "Transcription model could not be removed" }
  require(!directory.exists()) { "Transcription model is still stored on this device" }
  return deletedBytes
}

fun transcribeSamples(context: Context, model: String, language: String, samples: FloatArray, checkpointDirectory: File, progress: (Int, Int) -> Unit): Pair<String, List<String>> {
  require(language in setOf("auto", "ar", "en")) { "Transcription language is not supported" }
  require(installedTranscriptionModels(context).contains(model)) { "Download the $model transcription model first" }
  val chunkSamples = 29 * 16000
  val chunkCount = (samples.size + chunkSamples - 1) / chunkSamples
  require(checkpointDirectory.isDirectory || checkpointDirectory.mkdirs()) { "Transcription progress could not be saved" }
  val completedChunks = (0 until chunkCount).takeWhile { File(checkpointDirectory, "$it.txt").isFile }.count()
  if (completedChunks > 0) progress(completedChunks, chunkCount)
  if (completedChunks < chunkCount) {
    val directory = transcriptionDirectory(context, model)
    val whisper = OfflineWhisperModelConfig().apply {
      encoder = File(directory, "$model-encoder.int8.onnx").path
      decoder = File(directory, "$model-decoder.int8.onnx").path
      this.language = if (language == "auto") "" else language
      task = "transcribe"
    }
    val modelConfig = OfflineModelConfig().apply {
      this.whisper = whisper
      tokens = File(directory, "$model-tokens.txt").path
      numThreads = minOf(if (model == "medium") 2 else 4, Runtime.getRuntime().availableProcessors())
      debug = false
    }
    val recognizer = OfflineRecognizer(null, OfflineRecognizerConfig().apply { this.modelConfig = modelConfig })
    try {
      samples.indices.step(chunkSamples).drop(completedChunks).forEachIndexed { offset, start ->
        val index = completedChunks + offset
        val stream = recognizer.createStream()
        try {
          stream.acceptWaveform(samples.copyOfRange(start, minOf(start + chunkSamples, samples.size)), 16000)
          recognizer.decode(stream)
          val target = File(checkpointDirectory, "$index.txt")
          val temporary = File(checkpointDirectory, "$index.tmp")
          val recognition = recognizer.getResult(stream)
          val recognizedText = recognition.text.trim()
          temporary.writeText(recognizedText)
          if (recognizedText.isNotBlank() && recognition.lang.matches(Regex("[a-z]{2,3}"))) File(checkpointDirectory, "$index.lang").writeText(recognition.lang)
          require(temporary.renameTo(target)) { "Transcription progress could not be saved" }
          progress(index + 1, chunkCount)
        } finally {
          stream.release()
        }
      }
    } finally {
      recognizer.release()
    }
  }
  val transcript = (0 until chunkCount).map { File(checkpointDirectory, "$it.txt").readText() }.filter(String::isNotBlank).joinToString("\n\n")
  val detectedLanguages = (0 until chunkCount).mapNotNull { File(checkpointDirectory, "$it.lang").takeIf(File::isFile)?.readText() }.distinct()
  return transcript to detectedLanguages
}
