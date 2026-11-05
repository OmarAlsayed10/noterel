import { currentLanguage } from '../../i18n'

const copy = {
  reference: ['Save reference', 'حفظ المرجع'],
  referenceDetail: ['Keep this link now. Prepare readable content later.', 'احفظ الرابط الآن، وجهّز المحتوى للقراءة لاحقًا.'],
  prepare: ['Prepare for offline reading', 'تجهيز للقراءة دون اتصال'],
  prepareDetail: ['Fetch available text or captions after saving.', 'جلب النص أو الترجمة النصية المتاحة بعد الحفظ.'],
  takeaway: ['My takeaway (optional)', 'خلاصتي (اختياري)'],
  saved: ['Reference saved on this phone. No content was downloaded.', 'حُفظ المرجع على هذا الهاتف دون تنزيل المحتوى.'],
  prepareAction: ['Prepare content', 'تجهيز المحتوى'],
  referenceStatus: ['Reference saved · content not downloaded', 'مرجع محفوظ · لم يُنزّل المحتوى']
} as const

export const captureCopy = (key: keyof typeof copy): string => copy[key][currentLanguage() === 'ar' ? 1 : 0]
