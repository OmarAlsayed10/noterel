import { currentLanguage } from '../../i18n'

const copy = {
  saved: ['Link saved · content not prepared', 'الرابط محفوظ · المحتوى لم يُجهّز'],
  unavailable: ['The link is saved. Readable content could not be prepared.', 'الرابط محفوظ. تعذّر تجهيز المحتوى للقراءة.'],
  open: ['Open original', 'فتح المصدر الأصلي'],
  retry: ['Retry preparation', 'إعادة محاولة التجهيز'],
  prepare: ['Prepare content', 'تجهيز المحتوى'],
  noCaptions: ['No captions were available. Use the transcription options below.', 'لا توجد ترجمات نصية متاحة. استخدم خيارات تحويل الكلام إلى نص أدناه.'],
  transcribe: ['Transcribe video', 'تحويل الفيديو إلى نص'],
  choose: ['Choose video file', 'اختيار ملف فيديو'],
  preparing: ['Preparing video audio…', 'جارٍ تجهيز صوت الفيديو…'],
  preparingDetail: ['Your link stays saved. Speech recognition starts after you choose a model and language.', 'يبقى الرابط محفوظًا. يبدأ تحويل الكلام بعد اختيار الموديل ولغة الصوت.'],
  failed: ['The video could not be prepared. Your saved link is still available.', 'تعذّر تجهيز الفيديو. الرابط المحفوظ ما زال متاحًا.'],
  fileFailed: ['This video file could not be opened.', 'تعذّر فتح ملف الفيديو.'],
  httpFailure: ['Facebook could not provide the video audio (HTTP {status}). Choose a video file instead.', 'تعذّر جلب صوت الفيديو من فيسبوك (HTTP {status}). اختر ملف فيديو بدلًا من ذلك.'],
  saveReference: ['Save link without preparing', 'حفظ الرابط دون تجهيز'],
  upload: ['Video', 'فيديو'],
  uploadDetail: ['Transcribe speech from a video on your phone · up to 128 MiB or 30 minutes', 'تحويل الكلام من فيديو على هاتفك · حتى 128 ميبيبايت أو 30 دقيقة'],
  videoEyebrow: ['Transcribe video', 'تحويل الفيديو إلى نص'],
  videoPrivacy: ['Only the audio track is used for transcription. The temporary video copy is removed after processing.', 'يُستخدم مسار الصوت فقط للتحويل إلى نص. تُحذف نسخة الفيديو المؤقتة بعد المعالجة.']
} as const

export const videoRecoveryCopy = (key: keyof typeof copy): string => copy[key][currentLanguage() === 'ar' ? 1 : 0]
