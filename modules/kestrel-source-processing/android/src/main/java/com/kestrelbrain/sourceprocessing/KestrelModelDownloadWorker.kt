package com.kestrelbrain.sourceprocessing

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import java.io.IOException
import java.io.InterruptedIOException
import kotlin.math.roundToInt

private const val modelInput = "model"
private const val modelLanguageInput = "language"
private const val modelDownloadedInput = "downloaded"
private const val modelTotalInput = "total"
private const val modelErrorInput = "error"
private fun modelWorkName(model: String) = "kestrel-whisper-$model"

class KestrelModelDownloadWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
  private val model = requireNotNull(inputData.getString(modelInput))
  private val language = inputData.getString(modelLanguageInput) ?: "en"
  private var lastNotificationBytes = -1L

  override suspend fun doWork(): Result {
    return try {
      updateProgress(0, transcriptionModelBytes(model), true)
      downloadTranscriptionModel(applicationContext, model) { downloaded, total -> updateProgress(downloaded, total, downloaded == total) }
      showTaskCompletion(applicationContext, model.hashCode(), readyTitle(), readyDetail())
      Result.success(workDataOf(modelDownloadedInput to transcriptionModelBytes(model), modelTotalInput to transcriptionModelBytes(model)))
    } catch (error: IOException) {
      if (runAttemptCount < 5) Result.retry() else failure(error)
    } catch (error: Exception) {
      failure(error)
    }
  }

  private fun failure(error: Exception): Result {
    val title = if (language == "ar") "فشل تنزيل نموذج Whisper" else "Whisper download failed"
    showTaskCompletion(applicationContext, model.hashCode(), title, error.message ?: title)
    return Result.failure(workDataOf(modelErrorInput to (error.message ?: "Model download failed")))
  }

  private fun updateProgress(downloaded: Long, total: Long, force: Boolean) {
    if (isStopped) throw InterruptedIOException("Model download cancelled")
    if (!force && lastNotificationBytes >= 0 && downloaded - lastNotificationBytes < 1024 * 1024) return
    lastNotificationBytes = downloaded
    setProgressAsync(workDataOf(modelDownloadedInput to downloaded, modelTotalInput to total)).get()
    val percent = ((downloaded * 100.0) / total).roundToInt().coerceIn(0, 100)
    val remainingMb = (total - downloaded).coerceAtLeast(0) / (1024 * 1024)
    val detail = if (language == "ar") "$percent٪ · متبقي $remainingMb م.ب" else "$percent% · $remainingMb MB remaining"
    setForegroundAsync(taskForegroundInfo(applicationContext, model.hashCode(), downloadTitle(), detail, percent)).get()
  }

  private fun downloadTitle() = if (language == "ar") "تنزيل Whisper ${model.replaceFirstChar(Char::uppercase)}" else "Downloading Whisper ${model.replaceFirstChar(Char::uppercase)}"
  private fun readyTitle() = if (language == "ar") "نموذج Whisper جاهز" else "Whisper model ready"
  private fun readyDetail() = if (language == "ar") "اكتمل تنزيل Whisper ${model.replaceFirstChar(Char::uppercase)}" else "Whisper ${model.replaceFirstChar(Char::uppercase)} finished downloading"
}

fun enqueueTranscriptionModelDownload(context: Context, model: String, language: String) {
  transcriptionModelBytes(model)
  require(language in setOf("ar", "en")) { "App language is not supported" }
  if (installedTranscriptionModels(context).contains(model)) return
  val request = OneTimeWorkRequestBuilder<KestrelModelDownloadWorker>()
    .setInputData(workDataOf(modelInput to model, modelLanguageInput to language))
    .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
    .build()
  val modelName = model.replaceFirstChar(Char::uppercase)
  showTaskQueued(context, model.hashCode(), if (language == "ar") "تمت إضافة تنزيل Whisper $modelName" else "Whisper $modelName download queued", if (language == "ar") "في انتظار بدء التنزيل" else "Waiting for download to start")
  WorkManager.getInstance(context).enqueueUniqueWork(modelWorkName(model), ExistingWorkPolicy.KEEP, request)
}

fun transcriptionModelDownloadState(context: Context, model: String): Map<String, Any?> {
  val totalBytes = transcriptionModelBytes(model)
  if (installedTranscriptionModels(context).contains(model)) return mapOf("state" to "succeeded", "downloadedBytes" to totalBytes, "totalBytes" to totalBytes, "error" to null)
  val work = WorkManager.getInstance(context).getWorkInfosForUniqueWork(modelWorkName(model)).get().lastOrNull()
  val state = when (work?.state) {
    WorkInfo.State.ENQUEUED, WorkInfo.State.BLOCKED -> "queued"
    WorkInfo.State.RUNNING -> "downloading"
    WorkInfo.State.SUCCEEDED -> "succeeded"
    WorkInfo.State.FAILED -> "failed"
    WorkInfo.State.CANCELLED -> "cancelled"
    else -> "idle"
  }
  val progress: Data = if (work?.state == WorkInfo.State.FAILED) work.outputData else work?.progress ?: Data.EMPTY
  return mapOf("state" to state, "downloadedBytes" to progress.getLong(modelDownloadedInput, 0), "totalBytes" to progress.getLong(modelTotalInput, totalBytes), "error" to progress.getString(modelErrorInput))
}

fun cancelTranscriptionModelDownload(context: Context, model: String) {
  transcriptionModelBytes(model)
  WorkManager.getInstance(context).cancelUniqueWork(modelWorkName(model))
  hideTaskNotification(context, model.hashCode())
}
