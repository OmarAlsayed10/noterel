package com.kestrelbrain.sourceprocessing

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.work.ForegroundInfo

private const val taskNotificationChannel = "kestrel_background_tasks"

private fun taskPendingIntent(context: Context, id: Int, url: String?): PendingIntent? {
  val intent = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
  if (url != null) intent.setAction(Intent.ACTION_VIEW).setData(Uri.parse(url))
  return PendingIntent.getActivity(context, id, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
}

private fun taskNotificationBuilder(context: Context, title: String, detail: String, pendingIntent: PendingIntent?) = NotificationCompat.Builder(context, taskNotificationChannel)
  .setSmallIcon(android.R.drawable.stat_sys_download)
  .setContentTitle(title)
  .setContentText(detail)
  .setOnlyAlertOnce(true)
  .setContentIntent(pendingIntent)

private fun ensureTaskNotificationChannel(context: Context) {
  if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
  val notificationManager = context.getSystemService(NotificationManager::class.java)
  notificationManager.deleteNotificationChannel("kestrel_model_downloads")
  notificationManager.createNotificationChannel(NotificationChannel(taskNotificationChannel, "Background tasks", NotificationManager.IMPORTANCE_LOW))
}

fun taskForegroundInfo(context: Context, id: Int, title: String, detail: String, progress: Int?, url: String? = null): ForegroundInfo {
  ensureTaskNotificationChannel(context)
  val notification = taskNotificationBuilder(context, title, detail, taskPendingIntent(context, id, url))
    .setProgress(100, progress ?: 0, progress == null)
    .setOngoing(true)
    .build()
  return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ForegroundInfo(id, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC) else ForegroundInfo(id, notification)
}

fun showTaskQueued(context: Context, id: Int, title: String, detail: String) {
  ensureTaskNotificationChannel(context)
  val notification = taskNotificationBuilder(context, title, detail, taskPendingIntent(context, id, null))
    .setProgress(100, 0, true)
    .setOngoing(true)
    .build()
  runCatching { context.getSystemService(NotificationManager::class.java).notify(id, notification) }
}

fun hideTaskNotification(context: Context, id: Int) {
  context.getSystemService(NotificationManager::class.java).cancel(id)
}

fun showTaskCompletion(context: Context, id: Int, title: String, detail: String, url: String? = null) {
  ensureTaskNotificationChannel(context)
  val notification = taskNotificationBuilder(context, title, detail, taskPendingIntent(context, id, url))
    .setSmallIcon(android.R.drawable.stat_sys_download_done)
    .setAutoCancel(true)
    .build()
  runCatching { context.getSystemService(NotificationManager::class.java).notify(id xor 0x40000000, notification) }
}
