const { AndroidConfig, withAndroidManifest, withDangerousMod } = require('expo/config-plugins')
const fs = require('node:fs')
const path = require('node:path')

const processTextActivityName = '.KestrelProcessTextActivity'
const clipboardActivityName = '.KestrelClipboardActivity'
const quickCaptureActivityName = '.KestrelQuickCaptureActivity'
const tileServiceName = '.KestrelCaptureTileService'
const jotTileServiceName = '.KestrelJotTileService'
const audioTileServiceName = '.KestrelAudioTileService'
const widgetName = '.KestrelCaptureWidget'
const sharedFileMimeTypes = ['text/*', 'application/pdf', 'audio/*', 'video/*', 'application/ogg', 'application/octet-stream']

const withCaptureManifest = config => withAndroidManifest(config, androidConfig => {
  const displayName = androidConfig.name ?? 'Kestrel'
  const application = AndroidConfig.Manifest.getMainApplicationOrThrow(androidConfig.modResults)
  const generatedActivities = new Set([processTextActivityName, clipboardActivityName, quickCaptureActivityName])
  application.activity = (application.activity ?? []).filter(activity => !generatedActivities.has(activity.$?.['android:name']))
  application.activity.push({
    $: {
      'android:name': processTextActivityName,
      'android:excludeFromRecents': 'true',
      'android:exported': 'true',
      'android:label': `Add to ${displayName}`,
      'android:noHistory': 'true',
      'android:theme': '@android:style/Theme.Translucent.NoTitleBar'
    },
    'intent-filter': [{
      action: [{ $: { 'android:name': 'android.intent.action.PROCESS_TEXT' } }],
      category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
      data: [{ $: { 'android:mimeType': 'text/plain' } }]
    }]
  })
  application.activity.push({
    $: {
      'android:name': clipboardActivityName,
      'android:excludeFromRecents': 'true',
      'android:exported': 'false',
      'android:noHistory': 'true',
      'android:taskAffinity': '',
      'android:theme': '@android:style/Theme.Translucent.NoTitleBar'
    }
  })
  application.activity.push({
    $: {
      'android:name': quickCaptureActivityName,
      'android:excludeFromRecents': 'true',
      'android:exported': 'true',
      'android:noHistory': 'true',
      'android:taskAffinity': '',
      'android:theme': '@style/KestrelQuickCaptureTheme'
    },
    'intent-filter': [{
      action: [{ $: { 'android:name': 'android.intent.action.SEND' } }],
      category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
      data: sharedFileMimeTypes.map(mediaType => ({ $: { 'android:mimeType': mediaType } }))
    }]
  })
  const generatedServices = new Set([tileServiceName, jotTileServiceName, audioTileServiceName])
  application.service = (application.service ?? []).filter(service => !generatedServices.has(service.$?.['android:name']))
  application.service.push({
    $: {
      'android:name': tileServiceName,
      'android:exported': 'true',
      'android:icon': '@drawable/kestrel_tile',
      'android:label': 'Capture clipboard',
      'android:permission': 'android.permission.BIND_QUICK_SETTINGS_TILE'
    },
    'intent-filter': [{ action: [{ $: { 'android:name': 'android.service.quicksettings.action.QS_TILE' } }] }]
  }, {
    $: {
      'android:name': jotTileServiceName,
      'android:exported': 'true',
      'android:icon': '@drawable/kestrel_tile',
      'android:label': 'Quick jot',
      'android:permission': 'android.permission.BIND_QUICK_SETTINGS_TILE'
    },
    'intent-filter': [{ action: [{ $: { 'android:name': 'android.service.quicksettings.action.QS_TILE' } }] }]
  }, {
    $: {
      'android:name': audioTileServiceName,
      'android:exported': 'true',
      'android:icon': '@drawable/kestrel_tile',
      'android:label': 'Transcribe audio',
      'android:permission': 'android.permission.BIND_QUICK_SETTINGS_TILE'
    },
    'intent-filter': [{ action: [{ $: { 'android:name': 'android.service.quicksettings.action.QS_TILE' } }] }]
  })
  application.receiver = (application.receiver ?? []).filter(receiver => receiver.$?.['android:name'] !== widgetName)
  application.receiver.push({
    $: { 'android:name': widgetName, 'android:exported': 'true' },
    'intent-filter': [{ action: [{ $: { 'android:name': 'android.appwidget.action.APPWIDGET_UPDATE' } }] }],
    'meta-data': [{ $: { 'android:name': 'android.appwidget.provider', 'android:resource': '@xml/kestrel_widget_info' } }]
  })
  const mainActivity = application.activity.find(activity => activity['intent-filter']?.some(filter => filter.action?.some(action => action.$?.['android:name'] === 'android.intent.action.MAIN')))
  if (!mainActivity) throw new Error('Android main activity is required for capture shortcuts')
  mainActivity['intent-filter'] = (mainActivity['intent-filter'] ?? []).filter(filter => !filter.action?.some(action => action.$?.['android:name'] === 'android.intent.action.SEND'))
  mainActivity['meta-data'] = (mainActivity['meta-data'] ?? []).filter(metadata => metadata.$?.['android:name'] !== 'android.app.shortcuts')
  mainActivity['meta-data'].push({ $: { 'android:name': 'android.app.shortcuts', 'android:resource': '@xml/kestrel_shortcuts' } })
  return androidConfig
})

const withCaptureSources = config => withDangerousMod(config, ['android', async androidConfig => {
  const packageName = androidConfig.android?.package
  const scheme = Array.isArray(androidConfig.scheme) ? androidConfig.scheme[0] : androidConfig.scheme
  if (!packageName) throw new Error('Android package is required for text capture')
  if (!scheme) throw new Error('Application scheme is required for text capture')
  const appRoot = path.join(androidConfig.modRequest.platformProjectRoot, 'app', 'src', 'main')
  const sourceDirectory = path.join(appRoot, 'java', ...packageName.split('.'))
  const processTextSource = `package ${packageName}

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import java.nio.charset.StandardCharsets

class KestrelProcessTextActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val selectedText = intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT)?.toString()?.trim().orEmpty()
    if (selectedText.isEmpty() || selectedText.toByteArray(StandardCharsets.UTF_8).size > 1024 * 1024) {
      finish()
      return
    }
    startActivity(Intent(this, KestrelQuickCaptureActivity::class.java).apply {
      action = Intent.ACTION_SEND
      type = "text/plain"
      putExtra(Intent.EXTRA_TEXT, selectedText)
      addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    })
    finish()
  }
}
`
  const clipboardSource = `package ${packageName}

import android.app.Activity
import android.content.ClipboardManager
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import java.nio.charset.StandardCharsets

class KestrelClipboardActivity : Activity() {
  private var forwarded = false

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (!hasFocus || forwarded) return
    forwarded = true
    val clipboard = getSystemService(ClipboardManager::class.java)
    val text = clipboard.primaryClip?.getItemAt(0)?.coerceToText(this)?.toString()?.trim().orEmpty()
    val target = Intent(this, KestrelQuickCaptureActivity::class.java).apply {
      addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      data = Uri.parse(if (text.toByteArray(StandardCharsets.UTF_8).size <= 1024 * 1024) "${scheme}://capture/clipboard" else "${scheme}://capture/clipboard?error=clipboard-too-large")
      if (text.toByteArray(StandardCharsets.UTF_8).size <= 1024 * 1024) {
        action = Intent.ACTION_SEND
        type = "text/plain"
        putExtra(Intent.EXTRA_TEXT, text)
        putExtra(Intent.EXTRA_TITLE, "kestrel.quick-capture.v1")
      } else {
        action = Intent.ACTION_VIEW
      }
    }
    startActivity(target)
    finish()
  }
}
`
  const quickCaptureSource = `package ${packageName}

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import expo.modules.ReactActivityDelegateWrapper

private fun sharedFileMediaType(mediaType: String?, filename: String): String? {
  val extension = filename.substringAfterLast('.', "").lowercase()
  return when {
    mediaType == "application/pdf" || mediaType == "application/ogg" -> mediaType
    mediaType?.startsWith("audio/") == true || mediaType?.startsWith("video/") == true -> mediaType
    extension in setOf("mp4", "m4v", "mov", "mkv", "webm", "3gp") -> "video/*"
    extension in setOf("aac", "flac", "m4a", "mp3", "oga", "ogg", "opus", "wav") -> "audio/*"
    else -> null
  }
}

class KestrelQuickCaptureActivity : ReactActivity() {
  override fun getMainComponentName(): String = "main"

  override fun createReactActivityDelegate(): ReactActivityDelegate {
    return ReactActivityDelegateWrapper(
      this,
      BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
      object : DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled) {
        override fun getLaunchOptions(): Bundle = Bundle().apply {
          putBoolean("quickCapture", true)
          val sharedText = when (intent.action) {
            Intent.ACTION_SEND -> intent.getCharSequenceExtra(Intent.EXTRA_TEXT)
            Intent.ACTION_PROCESS_TEXT -> intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT)
            else -> null
          }
          if (sharedText != null) putString("quickCaptureText", sharedText.toString())
          val sharedFile = intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
          val mediaType = sharedFile?.let(contentResolver::getType) ?: intent.type
          if (sharedFile != null) {
            contentResolver.query(sharedFile, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
              if (cursor.moveToFirst()) {
                val filename = cursor.getString(0)
                val sharedMediaType = sharedFileMediaType(mediaType, filename)
                if (sharedMediaType != null) {
                  putString("quickCaptureFileUri", sharedFile.toString())
                  putString("quickCaptureFileName", filename)
                  putDouble("quickCaptureFileSize", cursor.getLong(1).toDouble())
                  putString("quickCaptureFileMimeType", sharedMediaType)
                }
              }
            }
          }
        }
      }
    )
  }

  override fun onStop() {
    super.onStop()
    if (!isChangingConfigurations) finishAndRemoveTask()
  }

  override fun invokeDefaultOnBackPressed() {
    finishAndRemoveTask()
  }
}
`
  const tileSource = `package ${packageName}

import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.service.quicksettings.TileService

private fun TileService.openCapture(capture: Intent, requestCode: Int) {
  capture.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
  if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
    val pending = PendingIntent.getActivity(this, requestCode, capture, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    startActivityAndCollapse(pending)
  } else {
    @Suppress("DEPRECATION")
    startActivityAndCollapse(capture)
  }
}

class KestrelCaptureTileService : TileService() {
  override fun onClick() {
    super.onClick()
    openCapture(Intent(this, KestrelClipboardActivity::class.java), 1)
  }
}

class KestrelJotTileService : TileService() {
  override fun onClick() {
    super.onClick()
    openCapture(Intent(this, KestrelQuickCaptureActivity::class.java), 2)
  }
}

class KestrelAudioTileService : TileService() {
  override fun onClick() {
    super.onClick()
    openCapture(Intent(Intent.ACTION_VIEW, Uri.parse("${scheme}://capture/audio"), this, MainActivity::class.java), 3)
  }
}
`
  const widgetSource = `package ${packageName}

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews

class KestrelCaptureWidget : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    for (id in ids) {
      val views = RemoteViews(context.packageName, R.layout.kestrel_widget)
      val note = Intent(Intent.ACTION_VIEW, Uri.parse("${scheme}://capture/note"), context, MainActivity::class.java)
      val audio = Intent(Intent.ACTION_VIEW, Uri.parse("${scheme}://capture/audio"), context, MainActivity::class.java)
      val clipboard = Intent(context, KestrelClipboardActivity::class.java)
      views.setOnClickPendingIntent(R.id.kestrel_widget_note, PendingIntent.getActivity(context, 10, note, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
      views.setOnClickPendingIntent(R.id.kestrel_widget_audio, PendingIntent.getActivity(context, 11, audio, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
      views.setOnClickPendingIntent(R.id.kestrel_widget_clipboard, PendingIntent.getActivity(context, 12, clipboard, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
      manager.updateAppWidget(id, views)
    }
  }
}
`
  const shortcuts = `<shortcuts xmlns:android="http://schemas.android.com/apk/res/android">
  <shortcut android:shortcutId="add_note" android:enabled="true" android:icon="@mipmap/ic_launcher" android:shortcutShortLabel="@string/kestrel_add_note">
    <intent android:action="android.intent.action.VIEW" android:data="${scheme}://capture/note" android:targetPackage="${packageName}" android:targetClass="${packageName}.MainActivity" />
  </shortcut>
  <shortcut android:shortcutId="transcribe_audio" android:enabled="true" android:icon="@mipmap/ic_launcher" android:shortcutShortLabel="@string/kestrel_transcribe_audio">
    <intent android:action="android.intent.action.VIEW" android:data="${scheme}://capture/audio" android:targetPackage="${packageName}" android:targetClass="${packageName}.MainActivity" />
  </shortcut>
</shortcuts>
`
  const strings = `<resources>
  <string name="kestrel_add_note">Add note</string>
  <string name="kestrel_transcribe_audio">Transcribe audio</string>
  <string name="kestrel_clipboard">Clipboard</string>
  <style name="KestrelQuickCaptureTheme" parent="Theme.AppCompat.DayNight.NoActionBar">
    <item name="android:windowIsTranslucent">true</item>
    <item name="android:windowBackground">@android:color/transparent</item>
    <item name="android:windowNoTitle">true</item>
    <item name="android:backgroundDimEnabled">true</item>
    <item name="android:backgroundDimAmount">0.22</item>
    <item name="android:windowCloseOnTouchOutside">false</item>
  </style>
</resources>
`
  const widgetLayout = `<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android" android:layout_width="match_parent" android:layout_height="match_parent" android:background="#FF17253B" android:gravity="center_vertical" android:orientation="vertical" android:padding="12dp">
  <TextView android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="@string/app_name" android:textColor="#FFD59B55" android:textSize="12sp" android:textStyle="bold" />
  <LinearLayout android:layout_width="match_parent" android:layout_height="wrap_content" android:layout_marginTop="6dp" android:orientation="horizontal">
    <Button android:id="@+id/kestrel_widget_note" android:layout_width="0dp" android:layout_height="48dp" android:layout_weight="1" android:text="@string/kestrel_add_note" android:textAllCaps="false" android:textSize="11sp" />
    <Button android:id="@+id/kestrel_widget_clipboard" android:layout_width="0dp" android:layout_height="48dp" android:layout_weight="1" android:text="@string/kestrel_clipboard" android:textAllCaps="false" android:textSize="11sp" />
    <Button android:id="@+id/kestrel_widget_audio" android:layout_width="0dp" android:layout_height="48dp" android:layout_weight="1" android:text="@string/kestrel_transcribe_audio" android:textAllCaps="false" android:textSize="11sp" />
  </LinearLayout>
</LinearLayout>
`
  const widgetInfo = `<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android" android:description="@string/kestrel_add_note" android:initialLayout="@layout/kestrel_widget" android:minHeight="82dp" android:minWidth="250dp" android:resizeMode="horizontal" android:updatePeriodMillis="0" android:widgetCategory="home_screen" />
`
  const tileIcon = `<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">
  <path android:fillColor="@android:color/transparent" android:pathData="M12,3.5a8.5,8.5 0,1 0,0 17a8.5,8.5 0,1 0,0 -17" android:strokeColor="#FFFFFFFF" android:strokeWidth="1.8" />
  <path android:fillColor="#FFFFFFFF" android:pathData="M12,9.8a2.2,2.2 0,1 0,0 4.4a2.2,2.2 0,1 0,0 -4.4M6.7,7.3a1.5,1.5 0,1 0,0 3a1.5,1.5 0,1 0,0 -3M17.3,13.7a1.5,1.5 0,1 0,0 3a1.5,1.5 0,1 0,0 -3" />
</vector>
`
  await Promise.all([
    fs.promises.mkdir(sourceDirectory, { recursive: true }),
    fs.promises.mkdir(path.join(appRoot, 'res', 'drawable'), { recursive: true }),
    fs.promises.mkdir(path.join(appRoot, 'res', 'layout'), { recursive: true }),
    fs.promises.mkdir(path.join(appRoot, 'res', 'xml'), { recursive: true }),
    fs.promises.mkdir(path.join(appRoot, 'res', 'values'), { recursive: true })
  ])
  await Promise.all([
    fs.promises.writeFile(path.join(sourceDirectory, 'KestrelProcessTextActivity.kt'), processTextSource),
    fs.promises.writeFile(path.join(sourceDirectory, 'KestrelClipboardActivity.kt'), clipboardSource),
    fs.promises.writeFile(path.join(sourceDirectory, 'KestrelQuickCaptureActivity.kt'), quickCaptureSource),
    fs.promises.writeFile(path.join(sourceDirectory, 'KestrelCaptureTileService.kt'), tileSource),
    fs.promises.writeFile(path.join(sourceDirectory, 'KestrelCaptureWidget.kt'), widgetSource),
    fs.promises.writeFile(path.join(appRoot, 'res', 'drawable', 'kestrel_tile.xml'), tileIcon),
    fs.promises.writeFile(path.join(appRoot, 'res', 'layout', 'kestrel_widget.xml'), widgetLayout),
    fs.promises.writeFile(path.join(appRoot, 'res', 'xml', 'kestrel_shortcuts.xml'), shortcuts),
    fs.promises.writeFile(path.join(appRoot, 'res', 'xml', 'kestrel_widget_info.xml'), widgetInfo),
    fs.promises.writeFile(path.join(appRoot, 'res', 'values', 'kestrel_shortcut_strings.xml'), strings)
  ])
  return androidConfig
}])

module.exports = config => withCaptureSources(withCaptureManifest(config))
