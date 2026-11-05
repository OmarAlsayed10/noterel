package com.kestrelbrain.sourceprocessing

import android.content.Context
import android.net.Uri
import java.io.File
import java.io.FileOutputStream
import java.io.InterruptedIOException
import java.net.URI
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import okhttp3.Call
import okhttp3.CookieJar
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody

internal const val facebookBrowserUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

private fun facebookHost(host: String?) = host != null && Regex("(^|[.])(facebook[.]com|fb[.]watch)$", RegexOption.IGNORE_CASE).containsMatchIn(host)

private const val maximumFacebookMediaBytes = 128L * 1024 * 1024
private val facebookMediaCalls = ConcurrentHashMap<String, Call>()
private val facebookMediaCancellations = ConcurrentHashMap<String, AtomicBoolean>()

private fun facebookMediaUri(rawUrl: String): URI {
  val uri = URI(rawUrl)
  require(uri.scheme == "https" && uri.host?.lowercase()?.endsWith(".fbcdn.net") == true && uri.userInfo == null && (uri.port == -1 || uri.port == 443) && uri.fragment == null && rawUrl.toByteArray().size <= 8192) { "Facebook media URL is invalid" }
  return uri
}

internal fun cancelFacebookVideoMedia(requestId: String) {
  facebookMediaCancellations.computeIfAbsent(requestId) { AtomicBoolean(false) }.set(true)
  facebookMediaCalls[requestId]?.cancel()
}

internal fun releaseFacebookVideoMedia(requestId: String) {
  facebookMediaCalls.remove(requestId)?.cancel()
  facebookMediaCancellations.remove(requestId)
}

private fun copyFacebookMedia(body: ResponseBody, target: File, cancellation: AtomicBoolean): Long {
  require(body.contentLength() <= maximumFacebookMediaBytes) { "Facebook video audio exceeds 128 MiB. Choose a smaller video file." }
  var copied = 0L
  body.byteStream().use { input -> FileOutputStream(target).use { output ->
    val buffer = ByteArray(64 * 1024)
    while (true) {
      if (cancellation.get() || Thread.currentThread().isInterrupted) throw InterruptedIOException("Facebook video preparation cancelled")
      val count = input.read(buffer)
      if (count < 0) break
      copied += count
      require(copied <= maximumFacebookMediaBytes) { "Facebook video audio exceeds 128 MiB. Choose a smaller video file." }
      output.write(buffer, 0, count)
    }
  } }
  require(copied > 0) { "Facebook video audio is empty" }
  return copied
}

private fun facebookMediaCall(httpClient: OkHttpClient, uri: URI, deadline: Long): Call {
  val remaining = deadline - System.nanoTime()
  require(remaining > 0) { "Facebook video preparation timed out" }
  val client = httpClient.newBuilder().cookieJar(CookieJar.NO_COOKIES).followRedirects(false).followSslRedirects(false).callTimeout(remaining, TimeUnit.NANOSECONDS).readTimeout(30, TimeUnit.SECONDS).build()
  val request = Request.Builder().url(uri.toString()).header("User-Agent", facebookBrowserUserAgent).header("Accept", "audio/mp4,video/mp4,application/octet-stream").build()
  return client.newCall(request)
}

private fun facebookMediaRedirect(response: Response, current: URI): URI? {
  if (response.code !in listOf(301, 302, 303, 307, 308)) return null
  val location = response.header("Location") ?: throw IllegalArgumentException("Facebook media redirect is missing")
  return facebookMediaUri(current.resolve(location).toString())
}

private fun facebookMediaCandidate(response: Response, target: File, cancellation: AtomicBoolean): Map<String, Any> {
  require(response.isSuccessful) { "Facebook video audio could not be downloaded (${response.code}). Choose a video file instead." }
  val body = requireNotNull(response.body) { "Facebook video audio is unavailable" }
  val contentType = body.contentType()?.toString()?.substringBefore(';')?.lowercase()
  require(contentType in listOf("audio/mp4", "video/mp4", "application/octet-stream")) { "Facebook did not return playable video audio" }
  val size = copyFacebookMedia(body, target, cancellation)
  if (cancellation.get()) throw InterruptedIOException("Facebook video preparation cancelled")
  return mapOf("uri" to Uri.fromFile(target).toString(), "filename" to "Facebook video audio.mp4", "size" to size, "mediaType" to if (contentType == "audio/mp4") "audio/mp4" else "video/mp4")
}

private fun downloadFacebookMedia(httpClient: OkHttpClient, rawUrl: String, requestId: String, target: File): Map<String, Any> {
  val cancellation = facebookMediaCancellations.getValue(requestId)
  val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(120)
  var current = facebookMediaUri(rawUrl)
  repeat(6) {
    if (cancellation.get()) throw InterruptedIOException("Facebook video preparation cancelled")
    val call = facebookMediaCall(httpClient, current, deadline)
    facebookMediaCalls[requestId] = call
    if (cancellation.get()) call.cancel()
    call.execute().use { response ->
      val redirect = facebookMediaRedirect(response, current)
      if (redirect != null) { current = redirect; return@repeat }
      return facebookMediaCandidate(response, target, cancellation)
    }
  }
  throw IllegalArgumentException("Facebook media redirected too many times")
}

internal fun prepareFacebookVideoMedia(context: Context, httpClient: OkHttpClient, rawUrl: String, requestId: String): Map<String, Any> {
  facebookMediaCancellations.computeIfAbsent(requestId) { AtomicBoolean(false) }
  var target: File? = null
  var completed = false
  try {
    val cacheFile = File.createTempFile("facebook-video-", ".mp4", context.cacheDir)
    target = cacheFile
    val candidate = downloadFacebookMedia(httpClient, rawUrl, requestId, cacheFile)
    completed = true
    return candidate
  } finally {
    releaseFacebookVideoMedia(requestId)
    if (!completed) target?.delete()
  }
}

internal fun fetchFacebookVideoPage(rawUrl: String, validatedUri: (String) -> URI, httpClient: OkHttpClient, responseText: (ResponseBody, Int) -> String): Map<String, String> {
  var current = validatedUri(rawUrl)
  require(facebookHost(current.host)) { "Facebook URL is invalid" }
  repeat(6) {
    val request = Request.Builder().url(current.toString())
      .header("User-Agent", facebookBrowserUserAgent)
      .header("Accept", "text/html,application/xhtml+xml")
      .header("Accept-Language", "en-US,en;q=0.9")
      .header("Sec-Fetch-Dest", "document")
      .header("Sec-Fetch-Mode", "navigate")
      .header("Sec-Fetch-Site", "none")
      .header("Upgrade-Insecure-Requests", "1")
      .build()
    httpClient.newCall(request).execute().use { response ->
      if (response.code in listOf(301, 302, 303, 307, 308)) {
        val location = response.header("Location") ?: throw IllegalArgumentException("URL redirect has no destination")
        current = validatedUri(current.resolve(location).toString())
        require(facebookHost(current.host)) { "Facebook redirected away from facebook.com" }
        return@repeat
      }
      require(response.isSuccessful) { "Facebook returned HTTP ${response.code}" }
      val body = requireNotNull(response.body) { "Facebook returned no content" }
      return mapOf("finalUrl" to current.toString(), "html" to responseText(body, 4 * 1024 * 1024))
    }
  }
  throw IllegalArgumentException("URL redirected too many times")
}
