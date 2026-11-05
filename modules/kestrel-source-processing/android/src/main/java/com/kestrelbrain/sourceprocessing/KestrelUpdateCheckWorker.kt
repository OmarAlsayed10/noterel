package com.kestrelbrain.sourceprocessing

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import java.io.IOException
import java.net.URI
import java.util.concurrent.TimeUnit
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONException
import org.json.JSONObject

private const val updateWorkName = "kestrel-update-check"
private const val updateChannel = "kestrel_app_updates"
private const val updateNotificationId = 0x13249
private const val updateUrlInput = "url"
private const val updateEditionInput = "edition"

class KestrelUpdateCheckWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
  override suspend fun doWork(): Result {
    val url = inputData.getString(updateUrlInput) ?: return Result.failure()
    val edition = inputData.getString(updateEditionInput) ?: return Result.failure()
    return try {
      val appConfig = JSONObject(applicationContext.assets.open("app.config").bufferedReader().use { it.readText() })
      if (appConfig.getJSONObject("extra").optString("updateMode") != "direct") return Result.success()
      val client = OkHttpClient.Builder().dns(publicDns).connectTimeout(10, TimeUnit.SECONDS).readTimeout(15, TimeUnit.SECONDS).build()
      client.newCall(Request.Builder().url(url).build()).execute().use { response ->
        if (!response.isSuccessful || response.request.url.scheme != "https") return Result.success()
        val body = response.peekBody(8193).string()
        if (body.toByteArray().size > 8192) return Result.success()
        val manifest = JSONObject(body)
        val version = manifest.getInt("versionCode")
        val packageInfo = applicationContext.packageManager.getPackageInfo(applicationContext.packageName, 0)
        val installed = if (Build.VERSION.SDK_INT >= 28) packageInfo.longVersionCode else packageInfo.versionCode.toLong()
        if (manifest.getString("packageName") == applicationContext.packageName && manifest.getString("edition") == edition && version > installed) notifyUpdate(version, manifest.getString("versionName"), edition)
      }
      Result.success()
    } catch (_: IOException) {
      if (runAttemptCount < 3) Result.retry() else Result.success()
    } catch (_: JSONException) {
      Result.success()
    }
  }

  private fun notifyUpdate(version: Int, name: String, edition: String) {
    val context = applicationContext
    if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
    val preferences = context.getSharedPreferences(updateWorkName, Context.MODE_PRIVATE)
    if (preferences.getInt("notified", 0) >= version) return
    val manager = context.getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(NotificationChannel(updateChannel, "App updates", NotificationManager.IMPORTANCE_DEFAULT))
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return
    val pending = PendingIntent.getActivity(context, updateNotificationId, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val title = if (edition == "internal") "Noterel $name is ready" else "Kestrel Mobile $name is ready"
    val notification = NotificationCompat.Builder(context, updateChannel)
      .setSmallIcon(android.R.drawable.stat_sys_download_done)
      .setContentTitle(title)
      .setContentText("Open the app to download and install the update")
      .setContentIntent(pending)
      .setAutoCancel(true)
      .build()
    manager.notify(updateNotificationId, notification)
    preferences.edit().putInt("notified", version).apply()
  }
}

fun scheduleUpdateChecks(context: Context, url: String, edition: String) {
  val uri = URI(url)
  require(uri.scheme == "https" && uri.host == "github.com" && uri.userInfo == null && uri.port == -1 && uri.rawQuery == null && uri.rawFragment == null && url.length <= 512 && uri.path.endsWith(if (edition == "internal") "/noterel-latest.json" else "/latest.json")) { "Update feed URL is invalid" }
  require(edition in setOf("public", "internal")) { "Update edition is invalid" }
  val request = PeriodicWorkRequestBuilder<KestrelUpdateCheckWorker>(12, TimeUnit.HOURS)
    .setInputData(workDataOf(updateUrlInput to url, updateEditionInput to edition))
    .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
    .build()
  WorkManager.getInstance(context).enqueueUniquePeriodicWork(updateWorkName, ExistingPeriodicWorkPolicy.UPDATE, request)
}

fun dismissUpdateAvailability(context: Context) {
  context.getSystemService(NotificationManager::class.java).cancel(updateNotificationId)
}

fun cancelUpdateChecks(context: Context) {
  WorkManager.getInstance(context).cancelUniqueWork(updateWorkName)
  dismissUpdateAvailability(context)
}
