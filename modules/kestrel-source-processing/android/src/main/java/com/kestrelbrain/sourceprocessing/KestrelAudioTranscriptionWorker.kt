package com.kestrelbrain.sourceprocessing

import android.content.Context
import android.net.Uri
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InterruptedIOException
import java.util.UUID

private const val audioJobInput = "jobId"
private const val audioModelInput = "model"
private const val audioLanguageInput = "language"
private const val audioInterfaceLanguageInput = "interfaceLanguage"
private const val audioTitleInput = "title"
private const val audioProgressInput = "progress"
private const val audioErrorInput = "error"
private const val maximumAudioBytes = 128L * 1024 * 1024
private val audioJobIdPattern = Regex("[0-9a-f-]{36}")
private fun audioJobName(jobId: String) = "kestrel-transcription-$jobId"
private fun audioJobDirectory(context: Context, jobId: String) = File(context.noBackupFilesDir, "transcription-jobs/$jobId")
private fun appScheme(context: Context) = if (context.packageName == "com.siderynlabs.noterel" || context.packageName.endsWith(".internal")) "noterel" else "kestrel-mobile"

private fun audioInput(context: Context, uri: Uri) = if (uri.scheme == "file") FileInputStream(requireNotNull(uri.path)) else requireNotNull(context.contentResolver.openInputStream(uri)) { "Audio file is unavailable" }

private fun copyAudioForTranscription(context: Context, uri: String, target: File) {
  audioInput(context, Uri.parse(uri)).use { input -> FileOutputStream(target).use { output ->
    val buffer = ByteArray(64 * 1024)
    var copied = 0L
    while (true) {
      val read = input.read(buffer)
      if (read < 0) break
      copied += read
      require(copied <= maximumAudioBytes) { "Choose audio no larger than 128 MiB" }
      output.write(buffer, 0, read)
    }
    require(copied > 0) { "Audio file is empty" }
  } }
}

class KestrelAudioTranscriptionWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
  private val jobId = requireNotNull(inputData.getString(audioJobInput))
  private val model = requireNotNull(inputData.getString(audioModelInput))
  private val language = requireNotNull(inputData.getString(audioLanguageInput))
  private val interfaceLanguage = inputData.getString(audioInterfaceLanguageInput) ?: language
  private val title = requireNotNull(inputData.getString(audioTitleInput))
  private val notificationId = jobId.hashCode()
  private val reviewUrl = "${appScheme(context)}://capture/transcript?job=$jobId"

  override suspend fun doWork(): Result {
    val directory = audioJobDirectory(applicationContext, jobId)
    return try {
      val transcriptFile = File(directory, "transcript.txt")
      if (!transcriptFile.isFile) {
        val checkpointDirectory = File(directory, "chunks")
        val resuming = checkpointDirectory.listFiles()?.any { it.extension == "txt" } == true
        if (!resuming) updateProgress(5, preparingDetail())
        val samples = decodeAudio(applicationContext, Uri.fromFile(File(directory, "audio")).toString())
        if (!resuming) updateProgress(15, startingModelDetail())
        val (transcript, detectedLanguages) = transcribeSamples(applicationContext, model, language, samples, checkpointDirectory) { completed, total ->
          if (isStopped) throw InterruptedIOException("Transcription cancelled")
          val percent = 15 + completed * 80 / total
          updateProgress(percent, transcribingDetail(percent))
        }
        require(transcript.isNotBlank()) { "No speech was recognized in this audio" }
        File(directory, "languages.txt").writeText(detectedLanguages.joinToString("\n"))
        File(directory, "duration.txt").writeText((samples.size.toDouble() / 16000).toString())
        transcriptFile.writeText(transcript)
      }
      File(directory, "audio").delete()
      File(directory, "chunks").deleteRecursively()
      showTaskCompletion(applicationContext, notificationId, completedTitle(), title, reviewUrl)
      Result.success(workDataOf(audioProgressInput to 100))
    } catch (_: OutOfMemoryError) {
      failure(directory, memoryFailure())
    } catch (error: Exception) {
      failure(directory, error.message ?: failedTitle())
    }
  }

  private fun failure(directory: File, detail: String): Result {
    File(directory, "audio").delete()
    if (!isStopped) showTaskCompletion(applicationContext, notificationId, failedTitle(), detail, reviewUrl)
    return Result.failure(workDataOf(audioErrorInput to detail))
  }

  private fun updateProgress(percent: Int, detail: String) {
    setProgressAsync(workDataOf(audioProgressInput to percent)).get()
    setForegroundAsync(taskForegroundInfo(applicationContext, notificationId, runningTitle(), detail, percent)).get()
  }

  private fun runningTitle() = if (interfaceLanguage == "ar") "تحويل الصوت لنص" else "Transcribing audio"
  private fun preparingDetail() = if (interfaceLanguage == "ar") "تجهيز $title" else "Preparing $title"
  private fun startingModelDetail() = if (interfaceLanguage == "ar") "تشغيل Whisper ${model.replaceFirstChar(Char::uppercase)}" else "Starting Whisper ${model.replaceFirstChar(Char::uppercase)}"
  private fun transcribingDetail(percent: Int) = if (interfaceLanguage == "ar") "$title · $percent٪" else "$title · $percent%"
  private fun completedTitle() = if (interfaceLanguage == "ar") "النص جاهز للمراجعة" else "Transcript ready to review"
  private fun failedTitle() = if (interfaceLanguage == "ar") "فشل تحويل الصوت" else "Transcription failed"
  private fun memoryFailure() = if (interfaceLanguage == "ar") "الموديل محتاج ذاكرة أكتر. جرّب Whisper Small." else "This model needs more memory. Try Whisper Small."
}

fun enqueueAudioTranscription(context: Context, uri: String, title: String, options: Map<String, String?>): String {
  val model = requireNotNull(options["model"])
  val language = requireNotNull(options["language"])
  val interfaceLanguage = requireNotNull(options["interfaceLanguage"])
  transcriptionModelBytes(model)
  require(language in setOf("auto", "ar", "en")) { "Transcription language is not supported" }
  require(interfaceLanguage in setOf("ar", "en")) { "App language is not supported" }
  val jobId = UUID.randomUUID().toString()
  val directory = audioJobDirectory(context, jobId)
  require(directory.mkdirs()) { "Transcription storage is unavailable" }
  val notificationId = jobId.hashCode()
  try {
    showTaskQueued(context, notificationId, if (interfaceLanguage == "ar") "تجهيز تحويل الصوت" else "Preparing transcription", title.take(200))
    copyAudioForTranscription(context, uri, File(directory, "audio"))
    File(directory, "title.txt").writeText(title.take(200))
    saveTranscriptionOrigin(directory, options["originJson"])
    val request = OneTimeWorkRequestBuilder<KestrelAudioTranscriptionWorker>()
      .setInputData(workDataOf(audioJobInput to jobId, audioModelInput to model, audioLanguageInput to language, audioInterfaceLanguageInput to interfaceLanguage, audioTitleInput to title.take(200)))
      .build()
    WorkManager.getInstance(context).enqueueUniqueWork(audioJobName(jobId), ExistingWorkPolicy.KEEP, request)
    showTaskQueued(context, notificationId, if (interfaceLanguage == "ar") "تحويل الصوت في الطابور" else "Transcription queued", title.take(200))
    return jobId
  } catch (error: Exception) {
    hideTaskNotification(context, notificationId)
    directory.deleteRecursively()
    throw error
  }
}

fun audioTranscriptionJob(context: Context, jobId: String): Map<String, Any?> {
  require(audioJobIdPattern.matches(jobId)) { "Transcription job is invalid" }
  val work = WorkManager.getInstance(context).getWorkInfosForUniqueWork(audioJobName(jobId)).get().lastOrNull()
  val directory = audioJobDirectory(context, jobId)
  val state = when (work?.state) {
    WorkInfo.State.ENQUEUED, WorkInfo.State.BLOCKED -> "queued"
    WorkInfo.State.RUNNING -> "transcribing"
    WorkInfo.State.SUCCEEDED -> "succeeded"
    WorkInfo.State.FAILED -> "failed"
    WorkInfo.State.CANCELLED -> "cancelled"
    else -> "missing"
  }
  val transcript = File(directory, "transcript.txt").takeIf(File::isFile)?.readText()
  val duration = File(directory, "duration.txt").takeIf(File::isFile)?.readText()?.toDoubleOrNull()
  val detectedLanguages = File(directory, "languages.txt").takeIf(File::isFile)?.readLines()?.filter { it.matches(Regex("[a-z]{2,3}")) } ?: emptyList()
  val progress = if (state == "succeeded") 100 else work?.progress?.getInt(audioProgressInput, 0) ?: 0
  return mapOf("id" to jobId, "state" to state, "progress" to progress, "title" to File(directory, "title.txt").takeIf(File::isFile)?.readText(), "text" to transcript, "detectedLanguages" to detectedLanguages, "durationSeconds" to duration, "error" to work?.outputData?.getString(audioErrorInput)) + transcriptionOrigin(directory)
}

fun audioTranscriptionJobs(context: Context): List<Map<String, Any?>> {
  val root = File(context.noBackupFilesDir, "transcription-jobs")
  return root.listFiles()?.filter { it.isDirectory && audioJobIdPattern.matches(it.name) }?.sortedByDescending(File::lastModified)?.take(20)?.map { audioTranscriptionJob(context, it.name) } ?: emptyList()
}

fun deleteAudioTranscriptionJob(context: Context, jobId: String) {
  require(audioJobIdPattern.matches(jobId)) { "Transcription job is invalid" }
  WorkManager.getInstance(context).cancelUniqueWork(audioJobName(jobId))
  hideTaskNotification(context, jobId.hashCode())
  val directory = audioJobDirectory(context, jobId)
  require(!directory.exists() || directory.deleteRecursively()) { "Transcription files could not be removed" }
}
