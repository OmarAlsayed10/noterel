import * as Crypto from 'expo-crypto'

export const hexadecimal = (bytes: ArrayBuffer | Uint8Array): string => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')

export const base64Url = (bytes: Uint8Array): string => {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

export const sha256 = async (bytes: Uint8Array): Promise<string> => hexadecimal(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, Uint8Array.from(bytes)))
