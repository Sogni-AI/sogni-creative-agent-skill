import { validateSegmentationPrompts } from './sam-segmentation.mjs';

export const SAM3_VIDEO_MODEL_ID = 'sam3_video_segment_fp16';

export function videoSegmentationConfig(bytes, source, { points = [], boxes = [], text, frameIndex = 0, objectIndex = 0, tokenType = 'spark' } = {}) {
  validateSegmentationPrompts(points, text, boxes);
  const { width, height, frames, fps } = source;
  if (![width, height, frames].every(value => Number.isSafeInteger(value) && value > 0)
    || width > 2560 || height > 2560 || frames > 900 || !Number.isFinite(fps) || fps < 1 || fps > 60 || frames / fps > 30 || bytes.length > 100 * 1024 * 1024) {
    throw new Error('Video selection accepts up to 30 seconds, 900 frames, 2560 pixels on either edge and 100 MB.');
  }
  if (!Number.isSafeInteger(frameIndex) || frameIndex < 0 || frameIndex >= frames) throw new Error('--segment-frame must be a zero-based source frame index.');
  if (!Number.isSafeInteger(objectIndex) || objectIndex < 0 || objectIndex > 31) throw new Error('--segment-object must be an index from 0 to 31.');
  return {
    modelId: SAM3_VIDEO_MODEL_ID, positivePrompt: '', referenceVideo: bytes, numberOfMedia: 1,
    width, height, frames, fps, outputFormat: 'mp4', disableNSFWFilter: true, tokenType,
    sam3VideoPrompt: { ...(points.length ? { points } : {}), ...(boxes.length ? { boxes } : {}), ...(text?.trim() ? { text: text.trim() } : {}), frameIndex, objectIndex, output: 'mask', edges: 'hard' },
    waitForCompletion: false, autoResizeVideoAssets: false,
  };
}
