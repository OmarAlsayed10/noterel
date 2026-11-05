package com.kestrelbrain.sourceprocessing

import android.content.Context
import android.os.Build
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import java.io.File
import java.io.IOException
import java.io.InterruptedIOException
import java.net.URI
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.TimeUnit
import okhttp3.OkHttpClient
import okhttp3.Request

private const val updateDownloadWork = "kestrel-update-download"
private const val updateDownloadNotification = 0x13250
private const val maximumUpdateBytes = 250L * 1024 * 1024
private const val updateVersionKey = "version"
private const val updateUrlKey = "url"
private const val updateDigestKey = "sha256"
private const val updateProgressKey = "progress"
private const val updateErrorKey = "error"
private const val updateWorkIdKey = "workId"

private fun installedUpdateVersion(context: Context): Long {
  val info = context.packageManager.getPackageInfo(context.packageName, 0)
  return if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()
}

private fun updateFile(context: Context, version: Int) = File(File(context.cacheDir, "updates"), "kestrel-$version.apk")

class KestrelUpdateDownloadWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
  private val version = inputData.getInt(updateVersionKey, 0)
  private val expectedDigest = inputData.getString(updateDigestKey) ?: ""
  private val client = OkHttpClient.Builder().dns(publicDns).followRedirects(false).connectTimeout(10, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS).build()

  override suspend fun doWork(): Result {
    val target = updateFile(applicationContext, version)
    val temporary = File(target.parentFile, "kestrel-$version.partial.apk")
    return try {
      require(version > installedUpdateVersion(applicationContext) && expectedDigest.matches(Regex("[0-9a-f]{64}"))) { "Update version or checksum is invalid" }
      target.parentFile?.mkdirs()
      progress(0)
      var current = URI(requireNotNull(inputData.getString(updateUrlKey)))
      var completed = false
      for (redirect in 0..5) {
        require(current.scheme == "https" && current.userInfo == null && current.port == -1 && current.host in setOf("github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com") && current.rawFragment == null) { "Update redirected to an unsafe URL" }
        client.newCall(Request.Builder().url(current.toString()).build()).execute().use { response ->
          if (response.code in listOf(301, 302, 303, 307, 308)) {
            current = current.resolve(requireNotNull(response.header("Location")) { "Update redirect is missing" })
            return@use
          }
          if (!response.isSuccessful) throw IOException("Update returned HTTP ${response.code}")
          val body = requireNotNull(response.body) { "Update response is empty" }
          require(body.contentLength() in -1..maximumUpdateBytes) { "Update exceeds download limit" }
          val digest = MessageDigest.getInstance("SHA-256")
          var downloaded = 0L
          var lastProgress = -1
          temporary.outputStream().buffered().use { output ->
            body.byteStream().use { input ->
              val buffer = ByteArray(64 * 1024)
              while (true) {
                if (isStopped) throw InterruptedIOException("Update download stopped")
                val count = input.read(buffer)
                if (count < 0) break
                downloaded += count
                require(downloaded <= maximumUpdateBytes) { "Update exceeds download limit" }
                output.write(buffer, 0, count)
                digest.update(buffer, 0, count)
                val percent = if (body.contentLength() > 0) (downloaded * 100 / body.contentLength()).toInt().coerceIn(0, 99) else 0
                if (percent > lastProgress) {
                  progress(percent)
                  lastProgress = percent
                }
              }
            }
          }
          require(downloaded > 0 && digest.digest().joinToString("") { "%02x".format(it) } == expectedDigest) { "Downloaded update failed checksum verification" }
          val archive = requireNotNull(applicationContext.packageManager.getPackageArchiveInfo(temporary.path, 0)) { "Downloaded update is not an APK" }
          val archiveVersion = if (Build.VERSION.SDK_INT >= 28) archive.longVersionCode else archive.versionCode.toLong()
          require(archive.packageName == applicationContext.packageName && archiveVersion == version.toLong()) { "Downloaded update is for a different app or version" }
          target.delete()
          require(temporary.renameTo(target)) { "Verified update could not be stored" }
          completed = true
        }
        if (completed) break
      }
      require(completed) { "Update redirected too many times" }
      showTaskCompletion(applicationContext, updateDownloadNotification, "Update ready to install", "Open the app to confirm installation")
      Result.success()
    } catch (error: Exception) {
      if (!isStopped && error is IOException && runAttemptCount < 3) {
        showTaskQueued(applicationContext, updateDownloadNotification, "App update queued", "Waiting for connection to retry")
        Result.retry()
      } else {
        if (!isStopped) showTaskCompletion(applicationContext, updateDownloadNotification, "Update download failed", "Open the app to retry")
        Result.failure(workDataOf(updateVersionKey to version, updateErrorKey to (error.message ?: "Update download failed")))
      }
    } finally {
      temporary.delete()
    }
  }

  private fun progress(percent: Int) {
    setProgressAsync(workDataOf(updateProgressKey to percent)).get()
    setForegroundAsync(taskForegroundInfo(applicationContext, updateDownloadNotification, "Downloading app update", "$percent% · You can leave the app", if (percent == 0) null else percent)).get()
  }
}

fun enqueueAppUpdate(context: Context, url: String, sha256: String, version: Int) {
  val config = org.json.JSONObject(context.assets.open("app.config").bufferedReader().use { it.readText() })
  require(config.getJSONObject("extra").optString("updateMode") == "direct" && version > installedUpdateVersion(context) && sha256.matches(Regex("[0-9a-f]{64}"))) { "Update is not valid for this installation" }
  val feed = URI(config.getJSONObject("extra").getString("updateManifestUrl"))
  val uri = URI(url)
  val releasePath = feed.rawPath.substringBefore("/releases/latest/download/") + "/releases/download/"
  require(uri.scheme == "https" && uri.host == "github.com" && uri.port == -1 && uri.userInfo == null && uri.rawQuery == null && uri.rawFragment == null && uri.rawPath.startsWith(releasePath) && uri.rawPath.endsWith(".apk") && url.length <= 2048) { "Update APK URL is invalid" }
  val manager = WorkManager.getInstance(context)
  val preferences = context.getSharedPreferences(updateDownloadWork, Context.MODE_PRIVATE)
  val previousVersion = preferences.getInt(updateVersionKey, 0)
  val previousId = preferences.getString(updateWorkIdKey, null)
  val existing = previousId?.let { manager.getWorkInfoById(UUID.fromString(it)).get() }
  if (previousVersion == version && preferences.getString(updateDigestKey, null) == sha256 && existing?.state in setOf(WorkInfo.State.ENQUEUED, WorkInfo.State.RUNNING, WorkInfo.State.SUCCEEDED) && (existing?.state != WorkInfo.State.SUCCEEDED || updateFile(context, version).isFile)) return
  val request = OneTimeWorkRequestBuilder<KestrelUpdateDownloadWorker>()
    .setInputData(workDataOf(updateVersionKey to version, updateUrlKey to url, updateDigestKey to sha256))
    .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
    .build()
  preferences.edit().putInt(updateVersionKey, version).putString(updateDigestKey, sha256).putString(updateWorkIdKey, request.id.toString()).apply()
  dismissUpdateAvailability(context)
  showTaskQueued(context, updateDownloadNotification, "App update queued", "Waiting to download")
  manager.enqueueUniqueWork(updateDownloadWork, ExistingWorkPolicy.REPLACE, request).result.get()
}

fun appUpdateDownloadState(context: Context): Map<String, Any?> {
  val version = context.getSharedPreferences(updateDownloadWork, Context.MODE_PRIVATE).getInt(updateVersionKey, 0)
  if (version <= installedUpdateVersion(context)) {
    if (version > 0) updateFile(context, version).delete()
    return mapOf("state" to "idle", "versionCode" to version, "progress" to 0, "path" to null, "error" to null)
  }
  val workId = context.getSharedPreferences(updateDownloadWork, Context.MODE_PRIVATE).getString(updateWorkIdKey, null)
  val work = workId?.let { WorkManager.getInstance(context).getWorkInfoById(UUID.fromString(it)).get() }
  val state = when (work?.state) {
    WorkInfo.State.ENQUEUED, WorkInfo.State.BLOCKED -> "queued"
    WorkInfo.State.RUNNING -> "downloading"
    WorkInfo.State.SUCCEEDED -> if (updateFile(context, version).isFile) "ready" else "failed"
    WorkInfo.State.FAILED, WorkInfo.State.CANCELLED -> "failed"
    else -> "idle"
  }
  return mapOf("state" to state, "versionCode" to version, "progress" to if (state == "ready") 100 else work?.progress?.getInt(updateProgressKey, 0) ?: 0, "path" to if (state == "ready") updateFile(context, version).absolutePath else null, "error" to if (state == "failed") work?.outputData?.getString(updateErrorKey) ?: "Downloaded update is no longer available" else null)
}
