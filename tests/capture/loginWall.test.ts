import { describe, expect, it } from 'vitest'
import { loginWalled } from '../../src/capture/readability'

describe('loginWalled', () => {
  it('flags Facebook login pages and keeps public content', () => {
    expect(loginWalled('https://m.facebook.com/share/r/abc/', 'يرجى تسجيل الدخول أو التسجيل لعرض المحتوى')).toBe(true)
    expect(loginWalled('https://m.facebook.com/login/?next=%2Fnasa', 'Facebook')).toBe(true)
    expect(loginWalled('https://www.facebook.com/share/p/abc/', 'Log in or sign up to view')).toBe(true)
    expect(loginWalled('https://www.facebook.com/NASA/', 'NASA - National Aeronautics and Space Administration')).toBe(false)
    expect(loginWalled('https://www.instagram.com/nasa/', 'NASA (@nasa) • Instagram photos and videos')).toBe(false)
    expect(loginWalled('https://example.com/login', 'Log in')).toBe(false)
  })
})
