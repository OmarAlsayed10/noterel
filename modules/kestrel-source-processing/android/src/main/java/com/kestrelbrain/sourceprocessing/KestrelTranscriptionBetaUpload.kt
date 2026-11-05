package com.kestrelbrain.sourceprocessing

import android.content.Context
import android.net.Uri
import java.io.File
import java.net.URI
import java.net.URLEncoder
import java.util.UUID
import java.util.concurrent.TimeUnit
import okhttp3.CookieJar
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody

private val betaUploadClient = OkHttpClient.Builder()
  .cookieJar(CookieJar.NO_COOKIES)
  .followRedirects(false)
  .followSslRedirects(false)
  .retryOnConnectionFailure(false)
  .connectTimeout(20, TimeUnit.SECONDS)
  .readTimeout(30, TimeUnit.SECONDS)
  .writeTimeout(120, TimeUnit.SECONDS)
  .callTimeout(180, TimeUnit.SECONDS)
  .build()

private fun betaUploadUrl(rawUrl: String): URI {
  val url = URI(rawUrl)
  require(rawUrl.length <= 2048 && url.scheme == "https" && !url.host.isNullOrBlank() && url.userInfo == null && url.query == null && url.fragment == null) { "Use an HTTPS beta server address" }
  require(Regex("/v1/beta/jobs/[0-9a-fA-F-]{36}").matches(url.path)) { "Invalid beta upload route" }
  UUID.fromString(url.path.substringAfterLast('/'))
  return url
}

private fun betaUploadFile(context: Context, rawUri: String, jobId: String): File {
  val uri = Uri.parse(rawUri)
  require(uri.scheme == "file" && uri.authority.isNullOrEmpty()) { "Beta audio must be stored on this phone" }
  val directory = File(context.filesDir, "transcription-beta").canonicalFile
  val file = File(requireNotNull(uri.path)).canonicalFile
  require(file.parentFile == directory && file.name == jobId && file.isFile) { "Beta audio is outside the transcription directory" }
  require(file.length() in 1..(128L * 1024 * 1024)) { "Choose audio or video no larger than 128 MiB" }
  return file
}

private fun betaUploadRequest(file: File, url: URI, options: Map<String, String?>): Request {
  val token = requireNotNull(options["token"])
  val filename = requireNotNull(options["filename"])
  val language = requireNotNull(options["language"])
  require(Regex("[A-Za-z0-9_-]{43}").matches(token)) { "Activate a beta invitation first" }
  require(filename.isNotBlank() && filename.toByteArray(Charsets.UTF_8).size <= 512 && filename.none { it.code < 32 || it.code == 127 }) { "Invalid recording filename" }
  require(language in listOf("auto", "ar", "en")) { "Choose the spoken language" }
  return Request.Builder().url(url.toString())
    .header("Authorization", "Bearer $token")
    .header("x-file-name", URLEncoder.encode(filename, "UTF-8").replace("+", "%20"))
    .header("x-language", language)
    .put(file.asRequestBody("application/octet-stream".toMediaType())).build()
}

internal fun uploadTranscriptionBetaFile(context: Context, uri: String, options: Map<String, String?>): Map<String, Any> {
  val url = betaUploadUrl(requireNotNull(options["url"]))
  val file = betaUploadFile(context, uri, url.path.substringAfterLast('/'))
  betaUploadClient.newCall(betaUploadRequest(file, url, options)).execute().use { response ->
    require(!response.isRedirect) { "The beta server redirected the upload; check its address" }
    val body = response.body?.let { responseText(it) } ?: ""
    return mapOf("status" to response.code, "body" to body)
  }
}
