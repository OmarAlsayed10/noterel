package com.kestrelbrain.sourceprocessing

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.common.model.DownloadConditions
import com.google.mlkit.common.model.RemoteModelManager
import com.google.mlkit.nl.translate.TranslateLanguage
import com.google.mlkit.nl.translate.TranslateRemoteModel
import java.util.concurrent.TimeUnit

private const val translationLanguageInput = "language"
private const val translationInterfaceLanguageInput = "interfaceLanguage"
private const val translationErrorInput = "error"
private fun translationWorkName(language: String) = "kestrel-translation-$language"
private fun translationNotificationId(language: String) = language.hashCode() xor 0x2f110000

private fun checkedTranslationLanguage(language: String): String {
  val normalized = language.trim().lowercase()
  require(TranslateLanguage.getAllLanguages().contains(normalized)) { "Translation language is not supported" }
  return normalized
}

private fun downloadedTranslationLanguages(): List<String> = Tasks.await(RemoteModelManager.getInstance().getDownloadedModels(TranslateRemoteModel::class.java), 30, TimeUnit.SECONDS).map { it.language }.sorted()

class KestrelTranslationDownloadWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
  private val language = checkedTranslationLanguage(requireNotNull(inputData.getString(translationLanguageInput)))
  private val interfaceLanguage = requireNotNull(inputData.getString(translationInterfaceLanguageInput))
  private val notificationId = translationNotificationId(language)

  override suspend fun doWork(): Result = try {
    if (downloadedTranslationLanguages().contains(language)) Result.success() else {
    setForeground(taskForegroundInfo(applicationContext, notificationId, runningTitle(), runningDetail(), null))
    val model = TranslateRemoteModel.Builder(language).build()
    Tasks.await(RemoteModelManager.getInstance().download(model, DownloadConditions.Builder().build()), 10, TimeUnit.MINUTES)
    require(downloadedTranslationLanguages().contains(language)) { "Language pack verification failed" }
    showTaskCompletion(applicationContext, notificationId, completedTitle(), completedDetail())
    Result.success()
    }
  } catch (error: Exception) {
    if (runAttemptCount < 2 && !isStopped) Result.retry() else {
      if (!isStopped) showTaskCompletion(applicationContext, notificationId, failedTitle(), error.message ?: failedTitle())
      Result.failure(workDataOf(translationErrorInput to (error.message ?: "Language pack download failed")))
    }
  }

  private fun runningTitle() = if (interfaceLanguage == "ar") "تنزيل حزمة لغة" else "Downloading language pack"
  private fun runningDetail() = if (interfaceLanguage == "ar") "الحزمة: $language" else "Language: $language"
  private fun completedTitle() = if (interfaceLanguage == "ar") "حزمة اللغة جاهزة" else "Language pack ready"
  private fun completedDetail() = if (interfaceLanguage == "ar") "اتنزّلت حزمة $language" else "$language is ready"
  private fun failedTitle() = if (interfaceLanguage == "ar") "فشل تنزيل حزمة اللغة" else "Language pack download failed"
}

fun translationDownloadStates(context: Context, rawLanguages: List<String>): List<Map<String, Any?>> {
  require(rawLanguages.size <= 32) { "Too many translation languages were requested" }
  val languages = rawLanguages.map(::checkedTranslationLanguage).distinct()
  val installed = downloadedTranslationLanguages().toSet()
  val manager = WorkManager.getInstance(context)
  return languages.map { language ->
    if (installed.contains(language)) mapOf("language" to language, "state" to "succeeded", "error" to null) else {
      val work = manager.getWorkInfosForUniqueWork(translationWorkName(language)).get().lastOrNull()
      val state = when (work?.state) {
        WorkInfo.State.ENQUEUED, WorkInfo.State.BLOCKED -> "queued"
        WorkInfo.State.RUNNING -> "downloading"
        WorkInfo.State.SUCCEEDED -> "succeeded"
        WorkInfo.State.FAILED -> "failed"
        WorkInfo.State.CANCELLED -> "cancelled"
        else -> "idle"
      }
      mapOf("language" to language, "state" to state, "error" to work?.outputData?.getString(translationErrorInput))
    }
  }
}

fun enqueueTranslationDownload(context: Context, rawLanguage: String, interfaceLanguage: String) {
  val language = checkedTranslationLanguage(rawLanguage)
  require(interfaceLanguage in setOf("ar", "en")) { "Interface language is not supported" }
  if (downloadedTranslationLanguages().contains(language)) return
  val request = OneTimeWorkRequestBuilder<KestrelTranslationDownloadWorker>()
    .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
    .setInputData(workDataOf(translationLanguageInput to language, translationInterfaceLanguageInput to interfaceLanguage))
    .build()
  WorkManager.getInstance(context).enqueueUniqueWork(translationWorkName(language), ExistingWorkPolicy.REPLACE, request)
}

fun removeTranslationModel(context: Context, rawLanguage: String) {
  val language = checkedTranslationLanguage(rawLanguage)
  WorkManager.getInstance(context).cancelUniqueWork(translationWorkName(language))
  val model = TranslateRemoteModel.Builder(language).build()
  Tasks.await(RemoteModelManager.getInstance().deleteDownloadedModel(model), 2, TimeUnit.MINUTES)
}

fun installedTranslationLanguages(): List<String> = downloadedTranslationLanguages()
