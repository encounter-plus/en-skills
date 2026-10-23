import {checkedPhoto,photoBase64,photoSha256} from './image-bytes.ts';
import { requestJson, object, type ConnectionOptions } from './http.ts';
export interface OcrEvidence {
  schemaVersion: 1; provider: string; imageSha256: string; capturedAt: string;
  fallback?: { used: true; reason: 'primary-provider-failed' };
  text: string; raw: Record<string, unknown>; needsVisualReview: true;
}
export interface OcrProvider { recognize(image: Uint8Array): Promise<OcrEvidence> }
export interface VisionOptions extends ConnectionOptions { quotaProject: string }
/** OCR evidence only: no expected answers, game mapping, current-marking claim or auto-acceptance. */
export class GoogleVisionOcr implements OcrProvider {
  #options: VisionOptions;
  constructor(options: VisionOptions) {
    if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(options.quotaProject)) throw new Error('Google quota project ID required');
    this.#options = { ...options };
  }
  async recognize(image: Uint8Array): Promise<OcrEvidence> {
    const {bytes}=checkedPhoto(image);
    const { data } = await requestJson(this.#options, 'https://vision.googleapis.com/v1/images:annotate',
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-user-project': this.#options.quotaProject },
        body: JSON.stringify({ requests: [{ image: { content: photoBase64(bytes) }, features: [{ type: 'TEXT_DETECTION' }] }] }) });
    if (!Array.isArray(data.responses) || data.responses.length !== 1) throw new Error('Invalid Vision response');
    const result = object(data.responses[0]);
    if (result.error) throw new Error('Vision image recognition failed');
    const annotation = Array.isArray(result.textAnnotations) && result.textAnnotations.length ? object(result.textAnnotations[0]) : null;
    const text = annotation?.description ?? '';
    if (typeof text !== 'string') throw new Error('Invalid Vision text');
    return { schemaVersion: 1, provider: 'google-cloud-vision', imageSha256: await photoSha256(bytes),
      capturedAt: new Date().toISOString(), text, raw: result, needsVisualReview: true };
  }
}
