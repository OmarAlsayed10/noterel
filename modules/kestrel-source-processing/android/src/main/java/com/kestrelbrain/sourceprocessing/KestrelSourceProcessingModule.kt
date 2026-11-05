package com.kestrelbrain.sourceprocessing

import android.content.Intent
import android.database.sqlite.SQLiteDatabase
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.graphics.pdf.PdfRenderer
import android.media.ExifInterface
import android.net.Uri
import android.os.Build
import android.os.ParcelFileDescriptor
import android.text.Html
import android.util.Base64
import androidx.core.content.FileProvider
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.nl.languageid.LanguageIdentification
import com.google.mlkit.nl.languageid.LanguageIdentificationOptions
import com.google.mlkit.nl.translate.TranslateLanguage
import com.google.mlkit.nl.translate.Translation
import com.google.mlkit.nl.translate.TranslatorOptions
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.Inet6Address
import java.net.InetAddress
import java.net.URI
import java.net.URLDecoder
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets
import java.util.UUID
import java.util.concurrent.TimeUnit
import java.util.zip.ZipInputStream
import kotlin.math.min
import okhttp3.Dns
import okhttp3.OkHttpClient
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.CountDownLatch

private const val maximumSourceBytes = 2 * 1024 * 1024
private const val maximumCaptionBytes = 8 * 1024 * 1024
private const val maximumPdfPages = 100
private const val maximumRenderedDimension = 1800
private val sensitiveParameter = Regex("(?:^|[_-])(?:auth|authorization|code|credential|key|password|secret|signature|token)(?:$|[_-])", RegexOption.IGNORE_CASE)
private fun publicAddress(address: InetAddress): Boolean {
  if (address.isAnyLocalAddress || address.isLoopbackAddress || address.isLinkLocalAddress || address.isSiteLocalAddress || address.isMulticastAddress) return false
  val bytes = address.address.map(Byte::toInt).map { it and 0xff }
  if (address is Inet6Address) {
    if (bytes.take(12) == List(10) { 0 } + listOf(0xff, 0xff)) return publicAddress(InetAddress.getByAddress(bytes.takeLast(4).map(Int::toByte).toByteArray()))
    return !(bytes[0] == 0xfc || bytes[0] == 0xfd || bytes.take(4) == listOf(0x20, 0x01, 0x0d, 0xb8))
  }
  return !(bytes[0] == 0 || bytes[0] == 10 || bytes[0] == 127 || bytes[0] >= 224 || bytes[0] == 100 && bytes[1] in 64..127 || bytes[0] == 169 && bytes[1] == 254 || bytes[0] == 172 && bytes[1] in 16..31 || bytes[0] == 192 && bytes[1] == 168 || bytes[0] == 192 && bytes[1] == 0 || bytes[0] == 192 && bytes[1] == 0 && bytes[2] == 2 || bytes[0] == 198 && bytes[1] in 18..19 || bytes[0] == 198 && bytes[1] == 51 && bytes[2] == 100 || bytes[0] == 203 && bytes[1] == 0 && bytes[2] == 113)
}
internal val publicDns = object : Dns {
  override fun lookup(hostname: String): List<InetAddress> = Dns.SYSTEM.lookup(hostname).also { addresses -> require(addresses.isNotEmpty() && addresses.all(::publicAddress)) { "URL resolves to a non-public address" } }
}
private val httpClient = OkHttpClient.Builder().dns(publicDns).followRedirects(false).connectTimeout(10, TimeUnit.SECONDS).readTimeout(15, TimeUnit.SECONDS).build()
private val captionClient = httpClient.newBuilder().readTimeout(60, TimeUnit.SECONDS).build()

class KestrelSourceProcessingModule : Module() {
  private fun validatedUri(rawUrl: String): URI {
    val uri = URI(rawUrl)
    val queryNames = uri.rawQuery?.split('&')?.map { URLDecoder.decode(it.substringBefore('='), StandardCharsets.UTF_8.name()).lowercase() } ?: emptyList()
    require(uri.scheme == "https" && uri.userInfo == null && (uri.port == -1 || uri.port == 443) && !uri.host.isNullOrBlank()) { "URL must be public HTTPS without credentials or a custom port" }
    require(rawUrl.toByteArray().size <= 4096 && queryNames.none(sensitiveParameter::containsMatchIn)) { "URL contains sensitive or excessive data" }
    return URI(uri.scheme, null, uri.host, uri.port, uri.path.ifEmpty { "/" }, uri.query, null)
  }

  private fun normalizedMediaType(contentType: String?): String {
    return when (contentType?.substringBefore(';')?.trim()?.lowercase()) {
      "text/html" -> "text/html"
      "text/plain" -> "text/plain"
      else -> throw IllegalArgumentException("URL content type is not supported")
    }
  }

  private val previewCrawlerHosts = Regex("(^|[.])(facebook[.]com|fb[.]watch|instagram[.]com|threads[.]net)$", RegexOption.IGNORE_CASE)

  private fun userAgentFor(uri: URI) = if (previewCrawlerHosts.containsMatchIn(uri.host ?: "")) "facebookexternalhit/1.1" else "Kestrel-Mobile/0.1"

  private fun request(uri: URI, accept: String) = Request.Builder().url(uri.toString()).header("Accept", accept).header("User-Agent", userAgentFor(uri)).build()


  private fun installPackage(path: String) {
    val context = requireNotNull(appContext.reactContext) { "Application context is unavailable" }
    val file = File(path)
    require(file.isFile && file.canonicalPath.startsWith(context.cacheDir.canonicalPath)) { "Update file is not in the cache directory" }
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.FileSystemFileProvider", file)
    val intent = Intent(Intent.ACTION_VIEW)
      .setDataAndType(uri, "application/vnd.android.package-archive")
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
    context.startActivity(intent)
  }

  private fun probeWebSocket(rawUrl: String): Map<String, Any?> {
    val uri = URI(rawUrl)
    require((uri.scheme == "wss" || uri.scheme == "https") && !uri.host.isNullOrBlank() && uri.userInfo == null) { "Probe URL must be a public wss URL" }
    val latch = CountDownLatch(1)
    var outcome: Map<String, Any?> = mapOf("state" to "timeout", "detail" to "No response within 15 seconds")
    val client = OkHttpClient.Builder().connectTimeout(10, TimeUnit.SECONDS).readTimeout(15, TimeUnit.SECONDS).build()
    val socket = client.newWebSocket(Request.Builder().url(rawUrl.replaceFirst("wss://", "https://")).build(), object : WebSocketListener() {
      override fun onOpen(webSocket: WebSocket, response: okhttp3.Response) {
        outcome = mapOf("state" to "open", "detail" to "HTTP ${response.code} ${response.protocol}")
        webSocket.close(1000, "probe")
        latch.countDown()
      }
      override fun onFailure(webSocket: WebSocket, t: Throwable, response: okhttp3.Response?) {
        val cause = generateSequence(t as Throwable?) { it.cause }.joinToString(" <- ") { "${it.javaClass.simpleName}: ${it.message ?: "no message"}" }
        outcome = mapOf("state" to "failed", "detail" to cause, "status" to response?.code)
        latch.countDown()
      }
    })
    latch.await(15, TimeUnit.SECONDS)
    socket.cancel()
    client.dispatcher.executorService.shutdown()
    return outcome
  }

  private fun importInput(uri: String) = Uri.parse(uri).let { parsed ->
    if (parsed.scheme == "file") FileInputStream(File(requireNotNull(parsed.path)))
    else requireNotNull(appContext.reactContext?.contentResolver?.openInputStream(parsed)) { "Import file could not be opened" }
  }

  private fun boundedImportBytes(input: java.io.InputStream, maximumBytes: Int): ByteArray {
    val output = ByteArrayOutputStream()
    val buffer = ByteArray(16 * 1024)
    while (true) {
      val read = input.read(buffer)
      if (read < 0) break
      require(output.size() + read <= maximumBytes) { "An imported note exceeds 1 MiB" }
      output.write(buffer, 0, read)
    }
    return output.toByteArray()
  }

  private fun decodedImportText(bytes: ByteArray): String {
    val decoder = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
    return decoder.decode(ByteBuffer.wrap(bytes)).toString().replace("\r\n", "\n").replace('\r', '\n').trim()
  }

  private fun importedTitle(path: String, text: String): String {
    val heading = text.lineSequence().firstOrNull { it.startsWith("# ") }?.removePrefix("# ")?.trim()
    val filename = path.substringAfterLast('/').substringBeforeLast('.').replace(Regex(" [0-9a-fA-F]{32}$"), "").trim()
    return (heading?.takeIf(String::isNotBlank) ?: filename.ifBlank { "Imported note" }).take(100)
  }

  private fun readableHtml(html: String): String = Html.fromHtml(html, Html.FROM_HTML_MODE_LEGACY).toString().replace(Regex("\n{3,}"), "\n\n").trim()

  private fun readNoteArchive(uri: String): Map<String, Any> {
    val notes = mutableListOf<Map<String, String>>()
    var totalBytes = 0
    var entries = 0
    ZipInputStream(BufferedInputStream(importInput(uri))).use { archive ->
      while (true) {
        val entry = archive.nextEntry ?: break
        entries += 1
        require(entries <= 1000) { "Archive contains too many entries" }
        val path = entry.name.replace('\\', '/')
        require(!path.startsWith('/') && path.split('/').none { it == ".." }) { "Archive contains an unsafe path" }
        if (!entry.isDirectory && (path.endsWith(".md", true) || path.endsWith(".markdown", true) || path.endsWith(".txt", true) || path.endsWith(".html", true))) {
          val raw = decodedImportText(boundedImportBytes(archive, maximumSourceBytes / 2))
          val text = if (path.endsWith(".html", true)) readableHtml(raw) else raw
          if (text.isNotBlank()) {
            totalBytes += text.toByteArray(StandardCharsets.UTF_8).size
            require(totalBytes <= 8 * 1024 * 1024 && notes.size < 500) { "Archive exceeds the note import limit" }
            notes.add(mapOf("title" to importedTitle(path, text), "text" to text, "sourcePath" to path))
          }
        }
        archive.closeEntry()
      }
    }
    require(notes.isNotEmpty()) { "Archive contains no supported notes" }
    return mapOf("kind" to "archive", "notes" to notes)
  }

  private fun ankiText(value: String): String {
    val withoutMedia = value.replace(Regex("\\[sound:[^]]+]", RegexOption.IGNORE_CASE), "")
      .replace(Regex("\\{\\{c\\d+::(.*?)(?:::[^}]*)?}}"), "$1")
    return readableHtml(withoutMedia)
  }

  private fun readAnkiPackage(uri: String): Map<String, Any> {
    val context = requireNotNull(appContext.reactContext) { "Application context is unavailable" }
    val collection = File(context.cacheDir, "anki-${UUID.randomUUID()}.db")
    try {
      var found = false
      ZipInputStream(BufferedInputStream(importInput(uri))).use { archive ->
        while (true) {
          val entry = archive.nextEntry ?: break
          if (!entry.isDirectory && entry.name in listOf("collection.anki2", "collection.anki21")) {
            FileOutputStream(collection).use { output ->
              val buffer = ByteArray(16 * 1024)
              var total = 0
              while (true) {
                val read = archive.read(buffer)
                if (read < 0) break
                total += read
                require(total <= 64 * 1024 * 1024) { "Anki collection is too large" }
                output.write(buffer, 0, read)
              }
            }
            found = true
            break
          }
          archive.closeEntry()
        }
      }
      require(found) { "Anki package does not contain a supported collection" }
      val notes = mutableListOf<Map<String, String>>()
      var totalBytes = 0
      SQLiteDatabase.openDatabase(collection.path, null, SQLiteDatabase.OPEN_READONLY).use { database ->
        database.rawQuery("SELECT flds FROM notes ORDER BY id LIMIT 501", null).use { cursor ->
          while (cursor.moveToNext()) {
            require(notes.size < 500) { "Anki package contains more than 500 notes" }
            val fields = cursor.getString(0).split('\u001f').map(::ankiText).filter(String::isNotBlank)
            if (fields.isNotEmpty()) {
              val text = fields.joinToString("\n\n")
              totalBytes += text.toByteArray(StandardCharsets.UTF_8).size
              require(text.toByteArray(StandardCharsets.UTF_8).size <= 1024 * 1024 && totalBytes <= 8 * 1024 * 1024) { "Anki package exceeds the note import limit" }
              notes.add(mapOf("title" to fields.first().take(100), "text" to text, "sourcePath" to "Anki note"))
            }
          }
        }
      }
      require(notes.isNotEmpty()) { "Anki package contains no readable notes" }
      return mapOf("kind" to "anki", "notes" to notes)
    } finally {
      collection.delete()
    }
  }

  private fun readNoteImport(uri: String, filename: String): Map<String, Any> = if (filename.lowercase().endsWith(".apkg")) readAnkiPackage(uri) else readNoteArchive(uri)

  private fun transcriptionContext() = requireNotNull(appContext.reactContext) { "Application context is unavailable" }

  private fun translationLanguage(language: String): String {
    val normalized = language.trim().lowercase()
    require(TranslateLanguage.getAllLanguages().contains(normalized)) { "Translation language is not supported" }
    return normalized
  }

  private fun translationChunks(text: String): List<String> {
    val chunks = mutableListOf<String>()
    var start = 0
    while (start < text.length) {
      var end = min(start + 3000, text.length)
      if (end < text.length) {
        val lineBreak = text.lastIndexOf('\n', end - 1)
        if (lineBreak > start + 1000) end = lineBreak
        if (end > start && Character.isHighSurrogate(text[end - 1])) end -= 1
      }
      chunks.add(text.substring(start, end).trim())
      start = end
    }
    return chunks.filter(String::isNotEmpty)
  }

  private fun translateText(text: String, targetLanguage: String): Map<String, String> {
    require(text.isNotBlank()) { "Text is required for translation" }
    val target = translationLanguage(targetLanguage)
    val identifier = LanguageIdentification.getClient(LanguageIdentificationOptions.Builder().setConfidenceThreshold(0.34f).build())
    val source = try {
      Tasks.await(identifier.identifyLanguage(text.take(10_000)), 30, TimeUnit.SECONDS)
    } finally {
      identifier.close()
    }
    require(source != "und" && TranslateLanguage.getAllLanguages().contains(source)) { "The source language could not be identified" }
    if (source == target) return mapOf("sourceLanguage" to source, "text" to text)
    val installed = installedTranslationLanguages().toSet()
    require(installed.contains(source)) { "Download the $source translation pack first" }
    require(installed.contains(target)) { "Download the $target translation pack first" }
    val options = TranslatorOptions.Builder().setSourceLanguage(source).setTargetLanguage(target).build()
    val translator = Translation.getClient(options)
    return try {
      val translated = translationChunks(text).map { chunk -> Tasks.await(translator.translate(chunk), 2, TimeUnit.MINUTES) }.joinToString("\n\n")
      mapOf("sourceLanguage" to source, "text" to translated)
    } finally {
      translator.close()
    }
  }

  private fun fetchPublicSource(rawUrl: String): Map<String, String> {
    var current = validatedUri(rawUrl)
    repeat(5) {
      httpClient.newCall(request(current, "text/html,text/plain")).execute().use { response ->
        if (response.code in listOf(301, 302, 303, 307, 308)) {
          val location = response.header("Location") ?: throw IllegalArgumentException("URL redirect has no destination")
          current = validatedUri(current.resolve(location).toString())
          return@repeat
        }
        require(response.isSuccessful) { "URL returned HTTP ${response.code}" }
        val body = requireNotNull(response.body) { "URL returned no content" }
        return mapOf("finalUrl" to current.toString(), "mediaType" to normalizedMediaType(body.contentType()?.toString()), "text" to responseText(body))
      }
    }
    throw IllegalArgumentException("URL redirected too many times")
  }

  private fun fetchYouTubePlayer(videoId: String, apiKey: String): String {
    require(Regex("^[A-Za-z0-9_-]{11}$").matches(videoId) && Regex("^[A-Za-z0-9_-]{20,64}$").matches(apiKey)) { "YouTube player request is invalid" }
    val body = """{"videoId":"$videoId","context":{"client":{"clientName":"ANDROID","clientVersion":"20.10.38","hl":"en"}}}""".toRequestBody("application/json".toMediaType())
    val request = Request.Builder().url("https://www.youtube.com/youtubei/v1/player?key=$apiKey").header("Accept", "application/json").header("User-Agent", "com.google.android.youtube/20.10.38").post(body).build()
    captionClient.newCall(request).execute().use { response ->
      require(response.isSuccessful) { "YouTube player details could not be retrieved" }
      return responseText(requireNotNull(response.body) { "YouTube player details are empty" }, 4 * 1024 * 1024)
    }
  }

  private fun fetchYouTubeCaptions(rawUrl: String): String {
    val uri = URI(rawUrl)
    require(uri.scheme == "https" && uri.host == "www.youtube.com" && uri.path == "/api/timedtext" && rawUrl.toByteArray().size <= 8192) { "YouTube caption URL is invalid" }
    val requested = URI(uri.scheme, null, uri.host, 443, uri.path, uri.query, null)
    captionClient.newCall(request(requested, "application/json")).execute().use { response ->
      require(response.isSuccessful) { "YouTube captions could not be retrieved" }
      return responseText(requireNotNull(response.body) { "YouTube captions are empty" }, maximumCaptionBytes)
    }
  }

  private fun fetchFacebookVideo(rawUrl: String): Map<String, String> = fetchFacebookVideoPage(rawUrl, ::validatedUri, httpClient, ::responseText)

  private fun fetchFacebookCaptions(rawUrl: String): String {
    val uri = URI(rawUrl)
    require(uri.scheme == "https" && uri.host?.lowercase()?.endsWith(".fbcdn.net") == true && uri.userInfo == null && (uri.port == -1 || uri.port == 443) && rawUrl.toByteArray().size <= 8192) { "Facebook caption URL is invalid" }
    val requested = URI(uri.scheme, null, uri.host, 443, uri.path, uri.query, null)
    val request = Request.Builder().url(requested.toString()).header("Accept", "text/plain,*/*").header("User-Agent", facebookBrowserUserAgent).build()
    captionClient.newCall(request).execute().use { response ->
      require(response.isSuccessful) { "Facebook captions could not be retrieved" }
      return responseText(requireNotNull(response.body) { "Facebook captions are empty" }, maximumCaptionBytes)
    }
  }

  private fun fetchTikTokCaptions(rawUrl: String): String {
    val uri = URI(rawUrl)
    require(uri.scheme == "https" && uri.host?.lowercase()?.endsWith(".tiktok.com") == true && uri.userInfo == null && (uri.port == -1 || uri.port == 443) && rawUrl.toByteArray().size <= 8192) { "TikTok caption URL is invalid" }
    val requested = URI(uri.scheme, null, uri.host, 443, uri.path, uri.query, null)
    captionClient.newCall(request(requested, "text/vtt,text/plain")).execute().use { response ->
      require(response.isSuccessful) { "TikTok captions could not be retrieved" }
      return responseText(requireNotNull(response.body) { "TikTok captions are empty" }, maximumCaptionBytes)
    }
  }

  private fun fetchYouTubeThumbnail(rawUrl: String): Map<String, String> {
    val uri = URI(rawUrl)
    require(uri.scheme == "https" && uri.host == "i.ytimg.com" && Regex("^/vi/[A-Za-z0-9_-]{11}/hqdefault\\.jpg$").matches(uri.path)) { "YouTube thumbnail URL is invalid" }
    httpClient.newCall(request(uri, "image/jpeg,image/webp,image/png")).execute().use { response ->
      require(response.isSuccessful) { "YouTube thumbnail could not be retrieved" }
      val body = requireNotNull(response.body) { "YouTube thumbnail is empty" }
      val mediaType = body.contentType()?.toString()?.substringBefore(';')?.lowercase()
      require(mediaType == "image/jpeg" || mediaType == "image/webp" || mediaType == "image/png") { "YouTube thumbnail type is invalid" }
      return mapOf("mediaType" to mediaType, "base64" to Base64.encodeToString(responseBytes(body, 512 * 1024), Base64.NO_WRAP))
    }
  }

  private fun imageBitmap(uri: String): Bitmap {
    val path = requireNotNull(Uri.parse(uri).path) { "Image could not be opened" }
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(path, bounds)
    require(bounds.outWidth in 1..20_000 && bounds.outHeight in 1..20_000 && bounds.outWidth.toLong() * bounds.outHeight <= 100_000_000) { "Image dimensions exceed the safe recognition limit" }
    var sampleSize = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / sampleSize > 2400) sampleSize *= 2
    val decoded = requireNotNull(BitmapFactory.decodeFile(path, BitmapFactory.Options().apply { inSampleSize = sampleSize })) { "Image format could not be decoded" }
    val orientation = ExifInterface(path).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
    val degrees = when (orientation) {
      ExifInterface.ORIENTATION_ROTATE_90 -> 90f
      ExifInterface.ORIENTATION_ROTATE_180 -> 180f
      ExifInterface.ORIENTATION_ROTATE_270 -> 270f
      else -> 0f
    }
    if (degrees == 0f) return decoded
    return Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, Matrix().apply { postRotate(degrees) }, true).also { decoded.recycle() }
  }

  private fun recognizeImage(uri: String): Map<String, Any> {
    val bitmap = imageBitmap(uri)
    try {
      val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
      val recognized = try {
        Tasks.await(recognizer.process(InputImage.fromBitmap(bitmap, 0)), 90, TimeUnit.SECONDS)
      } finally {
        recognizer.close()
      }
      val words = recognized.textBlocks.flatMap { block -> block.lines.flatMap { line -> line.elements } }.take(4096).mapNotNull { word ->
        val box = word.boundingBox ?: return@mapNotNull null
        mapOf<String, Any?>("text" to word.text, "left" to box.left.toDouble() / bitmap.width, "top" to box.top.toDouble() / bitmap.height, "width" to box.width().toDouble() / bitmap.width, "height" to box.height().toDouble() / bitmap.height, "confidence" to word.confidence.toDouble())
      }
      return mapOf("engine" to "play-services-ml-kit-text-recognition", "engineVersion" to "19.0.1", "width" to bitmap.width, "height" to bitmap.height, "text" to recognized.text, "words" to words)
    } finally {
      bitmap.recycle()
    }
  }

  private fun pdfDescriptor(uri: String): ParcelFileDescriptor {
    val parsed = Uri.parse(uri)
    if (parsed.scheme == "file") return ParcelFileDescriptor.open(File(requireNotNull(parsed.path)), ParcelFileDescriptor.MODE_READ_ONLY)
    return requireNotNull(appContext.reactContext?.contentResolver?.openFileDescriptor(parsed, "r")) { "PDF could not be opened" }
  }

  private fun embeddedPage(renderer: PdfRenderer, pageIndex: Int): Map<String, Any>? {
    if (Build.VERSION.SDK_INT < 35) return null
    renderer.openPage(pageIndex).use { page ->
      val text = page.textContents.map { content -> content.text.replace("\u0000", "").trim() }.filter(String::isNotEmpty).joinToString("\n")
      if (text.count(Char::isLetterOrDigit) < 16) return null
      return mapOf("pageNumber" to pageIndex + 1, "text" to text, "words" to emptyList<Map<String, Any>>())
    }
  }

  private fun recognizedPage(renderer: PdfRenderer, pageIndex: Int): Map<String, Any> {
    renderer.openPage(pageIndex).use { page ->
      val scale = min(1.0, maximumRenderedDimension.toDouble() / maxOf(page.width, page.height))
      val width = maxOf(1, (page.width * scale).toInt())
      val height = maxOf(1, (page.height * scale).toInt())
      val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
      try {
        page.render(bitmap, null, Matrix().apply { postScale(scale.toFloat(), scale.toFloat()) }, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
        val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
        val recognized = try {
          Tasks.await(recognizer.process(InputImage.fromBitmap(bitmap, 0)), 90, TimeUnit.SECONDS)
        } finally {
          recognizer.close()
        }
        val words = recognized.textBlocks.flatMap { block -> block.lines.flatMap { line -> line.elements } }.take(4096).mapNotNull { word ->
          val box = word.boundingBox ?: return@mapNotNull null
          mapOf<String, Any>("text" to word.text, "left" to box.left.toDouble() / width, "top" to box.top.toDouble() / height, "width" to box.width().toDouble() / width, "height" to box.height().toDouble() / height, "confidence" to word.confidence.toDouble())
        }
        return mapOf("pageNumber" to pageIndex + 1, "text" to recognized.text, "words" to words)
      } finally {
        bitmap.recycle()
      }
    }
  }

  private fun recognizePdf(uri: String): Map<String, Any> {
    pdfDescriptor(uri).use { descriptor ->
      PdfRenderer(descriptor).use { renderer ->
        require(renderer.pageCount in 1..maximumPdfPages) { "PDF must contain between 1 and $maximumPdfPages pages" }
        var embeddedPages = 0
        val pages = (0 until renderer.pageCount).map { pageIndex ->
          embeddedPage(renderer, pageIndex)?.also { embeddedPages += 1 } ?: recognizedPage(renderer, pageIndex)
        }
        require(pages.any { (it["text"] as String).isNotBlank() }) { "Recognition produced no readable text" }
        val engine = when (embeddedPages) {
          0 -> "play-services-ml-kit-text-recognition"
          pages.size -> "android-pdf-renderer-text"
          else -> "android-pdf-renderer-text+play-services-ml-kit-text-recognition"
        }
        val version = when (embeddedPages) {
          0 -> "19.0.1"
          pages.size -> "35"
          else -> "35+19.0.1"
        }
        return mapOf("engine" to engine, "engineVersion" to version, "language" to "und", "pages" to pages)
      }
    }
  }

  override fun definition() = ModuleDefinition {
    Name("KestrelSourceProcessing")
    AsyncFunction("probeWebSocket") { url: String -> probeWebSocket(url) }
    AsyncFunction("installPackage") { path: String -> installPackage(path) }
    AsyncFunction("scheduleUpdateChecks") { url: String, edition: String -> scheduleUpdateChecks(requireNotNull(appContext.reactContext), url, edition) }
    AsyncFunction("cancelUpdateChecks") { cancelUpdateChecks(requireNotNull(appContext.reactContext)) }
    AsyncFunction("enqueueAppUpdate") { url: String, sha256: String, version: Int -> enqueueAppUpdate(requireNotNull(appContext.reactContext), url, sha256, version) }
    AsyncFunction("appUpdateDownloadState") { appUpdateDownloadState(requireNotNull(appContext.reactContext)) }
    AsyncFunction("readNoteImport") { uri: String, filename: String -> readNoteImport(uri, filename) }
    AsyncFunction("installedTranscriptionModels") { installedTranscriptionModels(transcriptionContext()) }
    AsyncFunction("downloadTranscriptionModel") { model: String, language: String -> enqueueTranscriptionModelDownload(transcriptionContext(), model, language) }
    AsyncFunction("transcriptionModelDownloadState") { model: String -> transcriptionModelDownloadState(transcriptionContext(), model) }
    AsyncFunction("cancelTranscriptionModelDownload") { model: String -> cancelTranscriptionModelDownload(transcriptionContext(), model) }
    AsyncFunction("deleteTranscriptionModel") { model: String -> deleteTranscriptionModel(transcriptionContext(), model) }
    AsyncFunction("enqueueAudioTranscription") { uri: String, title: String, options: Map<String, String?> -> enqueueAudioTranscription(transcriptionContext(), uri, title, options) }
    AsyncFunction("uploadTranscriptionBetaFile") { uri: String, options: Map<String, String?> -> uploadTranscriptionBetaFile(transcriptionContext(), uri, options) }
    AsyncFunction("audioTranscriptionJob") { jobId: String -> audioTranscriptionJob(transcriptionContext(), jobId) }
    AsyncFunction("audioTranscriptionJobs") { audioTranscriptionJobs(transcriptionContext()) }
    AsyncFunction("deleteAudioTranscriptionJob") { jobId: String -> deleteAudioTranscriptionJob(transcriptionContext(), jobId) }
    AsyncFunction("downloadedTranslationModels") { installedTranslationLanguages() }
    AsyncFunction("downloadTranslationModel") { language: String, interfaceLanguage: String -> enqueueTranslationDownload(transcriptionContext(), language, interfaceLanguage) }
    AsyncFunction("translationModelDownloadStates") { languages: List<String> -> translationDownloadStates(transcriptionContext(), languages) }
    AsyncFunction("deleteTranslationModel") { language: String -> removeTranslationModel(transcriptionContext(), language) }
    AsyncFunction("translateText") { text: String, targetLanguage: String -> translateText(text, targetLanguage) }
    AsyncFunction("fetchPublicSource") { url: String -> fetchPublicSource(url) }
    AsyncFunction("fetchYouTubePlayer") { videoId: String, apiKey: String -> fetchYouTubePlayer(videoId, apiKey) }
    AsyncFunction("fetchYouTubeCaptions") { url: String -> fetchYouTubeCaptions(url) }
    AsyncFunction("fetchTikTokCaptions") { url: String -> fetchTikTokCaptions(url) }
    AsyncFunction("fetchFacebookVideo") { url: String -> fetchFacebookVideo(url) }
    AsyncFunction("prepareFacebookVideoMedia") { url: String, requestId: String -> prepareFacebookVideoMedia(transcriptionContext(), httpClient, url, requestId) }
    Function("cancelFacebookVideoMedia") { requestId: String -> cancelFacebookVideoMedia(requestId) }
    Function("releaseFacebookVideoMedia") { requestId: String -> releaseFacebookVideoMedia(requestId) }
    AsyncFunction("fetchFacebookCaptions") { url: String -> fetchFacebookCaptions(url) }
    AsyncFunction("fetchYouTubeThumbnail") { url: String -> fetchYouTubeThumbnail(url) }
    AsyncFunction("recognizeImage") { uri: String -> recognizeImage(uri) }
    AsyncFunction("recognizePdf") { uri: String -> recognizePdf(uri) }
  }
}
