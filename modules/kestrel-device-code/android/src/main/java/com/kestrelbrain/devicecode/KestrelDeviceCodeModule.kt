package com.kestrelbrain.devicecode

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val channelId = "codex-device-code"
private const val notificationId = 71421
private const val lifetimeMilliseconds = 15L * 60L * 1000L

class KestrelDeviceCodeModule : Module() {
  private fun context(): Context = requireNotNull(appContext.reactContext)

  private fun notificationManager(): NotificationManager = context().getSystemService(NotificationManager::class.java)

  private fun createChannel(manager: NotificationManager) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val channel = NotificationChannel(channelId, "Codex sign-in code", NotificationManager.IMPORTANCE_HIGH)
    channel.description = "Temporary code shown while signing in to Codex"
    channel.lockscreenVisibility = Notification.VISIBILITY_SECRET
    channel.setShowBadge(false)
    manager.createNotificationChannel(channel)
  }

  private fun notification(code: String): Notification {
    val context = context()
    val launchIntent = requireNotNull(context.packageManager.getLaunchIntentForPackage(context.packageName))
    val pendingIntent = PendingIntent.getActivity(context, 0, launchIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val icon = context.resources.getIdentifier("kestrel_tile", "drawable", context.packageName).takeIf { it != 0 } ?: android.R.drawable.ic_dialog_info
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(context, channelId) else Notification.Builder(context)
    return builder.setSmallIcon(icon).setContentTitle("Codex device code").setContentText(code).setContentIntent(pendingIntent).setAutoCancel(false).setOnlyAlertOnce(true).setPriority(Notification.PRIORITY_HIGH).setVisibility(Notification.VISIBILITY_SECRET).setTimeoutAfter(lifetimeMilliseconds).build()
  }

  override fun definition() = ModuleDefinition {
    Name("KestrelDeviceCode")

    AsyncFunction("show") { code: String ->
      val manager = notificationManager()
      createChannel(manager)
      manager.notify(notificationId, notification(code))
    }

    AsyncFunction("dismiss") {
      notificationManager().cancel(notificationId)
    }
  }
}
