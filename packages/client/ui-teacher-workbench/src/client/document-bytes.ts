/** Browser byte encoding shared by OCR, speech, and collection uploads. */

/**
 * Encode browser bytes for JSON RPC media transport.
 * @param data - Browser-held bytes to encode.
 * @returns Canonical Base64 content.
 */
export function bytesToBase64(data: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let offset = 0; offset < data.length; offset += chunk) {
    binary += String.fromCharCode(...data.subarray(offset, offset + chunk))
  }
  return btoa(binary)
}
