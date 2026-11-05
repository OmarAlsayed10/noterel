package com.kestrelbrain.sourceprocessing

import android.content.Context
import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder

private const val transcriptionSampleRate = 16000
private const val maximumAudioDurationUs = 30L * 60 * 1_000_000

private fun configuredExtractor(context: Context, uri: String): Pair<MediaExtractor, MediaFormat> {
  val extractor = MediaExtractor()
  val parsed = Uri.parse(uri)
  if (parsed.scheme == "file") extractor.setDataSource(requireNotNull(parsed.path)) else extractor.setDataSource(context, parsed, null)
  for (index in 0 until extractor.trackCount) {
    val format = extractor.getTrackFormat(index)
    if (format.getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true) {
      require(format.getLong(MediaFormat.KEY_DURATION) in 1..maximumAudioDurationUs) { "Audio must be no longer than 30 minutes" }
      extractor.selectTrack(index)
      return extractor to format
    }
  }
  extractor.release()
  throw IllegalArgumentException("File contains no supported audio track")
}

private fun pcmSample(buffer: ByteBuffer, offset: Int, encoding: Int): Float = when (encoding) {
  AudioFormat.ENCODING_PCM_FLOAT -> buffer.getFloat(offset).coerceIn(-1f, 1f)
  AudioFormat.ENCODING_PCM_8BIT -> ((buffer.get(offset).toInt() and 0xff) - 128) / 128f
  else -> buffer.getShort(offset) / 32768f
}

private fun appendMonoPcm(output: ByteArrayOutputStream, buffer: ByteBuffer, channels: Int, sampleRate: Int, encoding: Int, sourceFrames: LongArray, outputFrames: LongArray) {
  val bytesPerSample = when (encoding) {
    AudioFormat.ENCODING_PCM_FLOAT -> 4
    AudioFormat.ENCODING_PCM_8BIT -> 1
    else -> 2
  }
  val frameBytes = bytesPerSample * channels
  var offset = buffer.position()
  while (offset + frameBytes <= buffer.limit()) {
    var mono = 0f
    for (channel in 0 until channels) mono += pcmSample(buffer, offset + channel * bytesPerSample, encoding)
    mono /= channels
    sourceFrames[0] += 1
    val expectedOutputFrames = sourceFrames[0] * transcriptionSampleRate / sampleRate
    while (outputFrames[0] < expectedOutputFrames) {
      val sample = (mono.coerceIn(-1f, 1f) * 32767).toInt()
      output.write(sample and 0xff)
      output.write(sample shr 8 and 0xff)
      outputFrames[0] += 1
    }
    offset += frameBytes
  }
}

fun decodeAudio(context: Context, uri: String): FloatArray {
  val (extractor, inputFormat) = configuredExtractor(context, uri)
  val mime = requireNotNull(inputFormat.getString(MediaFormat.KEY_MIME))
  val codec = MediaCodec.createDecoderByType(mime)
  val pcm = ByteArrayOutputStream()
  val sourceFrames = longArrayOf(0)
  val outputFrames = longArrayOf(0)
  var channels = inputFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
  var sampleRate = inputFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)
  var encoding = AudioFormat.ENCODING_PCM_16BIT
  try {
    codec.configure(inputFormat, null, null, 0)
    codec.start()
    val info = MediaCodec.BufferInfo()
    var inputFinished = false
    var outputFinished = false
    while (!outputFinished) {
      if (!inputFinished) {
        val inputIndex = codec.dequeueInputBuffer(10_000)
        if (inputIndex >= 0) {
          val input = requireNotNull(codec.getInputBuffer(inputIndex))
          val size = extractor.readSampleData(input, 0)
          if (size < 0) {
            codec.queueInputBuffer(inputIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
            inputFinished = true
          } else {
            codec.queueInputBuffer(inputIndex, 0, size, extractor.sampleTime, 0)
            extractor.advance()
          }
        }
      }
      when (val outputIndex = codec.dequeueOutputBuffer(info, 10_000)) {
        MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
          val format = codec.outputFormat
          channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
          sampleRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
          if (format.containsKey(MediaFormat.KEY_PCM_ENCODING)) encoding = format.getInteger(MediaFormat.KEY_PCM_ENCODING)
          require(channels in 1..8 && sampleRate in 8000..192000 && encoding in setOf(AudioFormat.ENCODING_PCM_8BIT, AudioFormat.ENCODING_PCM_16BIT, AudioFormat.ENCODING_PCM_FLOAT)) { "Decoded audio format is not supported" }
        }
        else -> if (outputIndex >= 0) {
          val output = requireNotNull(codec.getOutputBuffer(outputIndex)).order(ByteOrder.nativeOrder())
          output.position(info.offset)
          output.limit(info.offset + info.size)
          appendMonoPcm(pcm, output, channels, sampleRate, encoding, sourceFrames, outputFrames)
          outputFinished = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
          codec.releaseOutputBuffer(outputIndex, false)
        }
      }
    }
  } finally {
    try { codec.stop() } catch (_: IllegalStateException) { }
    codec.release()
    extractor.release()
  }
  val bytes = pcm.toByteArray()
  require(bytes.isNotEmpty()) { "Audio produced no readable samples" }
  val samples = FloatArray(bytes.size / 2)
  val shorts = ShortArray(samples.size)
  ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().get(shorts)
  for (index in shorts.indices) samples[index] = shorts[index] / 32768f
  return samples
}
