export const SAM3_MODEL_ID = 'sam3_image_segment_bf16';

export function segmentPoint(value, label) {
  const parts = value.split(',');
  const coordinates = parts.map(Number);
  if (parts.length !== 2 || parts.some(part => !part.trim()) || coordinates.some(n => !Number.isFinite(n) || n < 0 || n > 1)) {
    throw new Error('Selection points use normalized x,y coordinates between 0 and 1.');
  }
  return { x: coordinates[0], y: coordinates[1], label };
}

export function segmentBox(value) {
  const parts = value.split(','); const [x0, y0, x1, y1] = parts.map(Number);
  if (parts.length !== 4 || parts.some(part => !part.trim()) || [x0, y0, x1, y1].some(n => !Number.isFinite(n) || n < 0 || n > 1) || x0 >= x1 || y0 >= y1) {
    throw new Error('Selection boxes use normalized x0,y0,x1,y1 coordinates, with x0 < x1 and y0 < y1.');
  }
  return { x0, y0, x1, y1 };
}

export function validateSegmentationPrompts(points, text, boxes = []) {
  const label = text?.trim();
  if (points.length > 32 || boxes.length > 16 || (label?.length ?? 0) > 240 || (!points.some(point => point.label === 'positive') && !label && !boxes.length)) {
    throw new Error('Supply a positive point, box or object description; use at most 32 points, 16 boxes and 240 text characters.');
  }
  if (label && points.length) throw new Error('Text and point prompts cannot be combined; use text with optional boxes, or points with at most one box.');
  if (points.length && boxes.length > 1) throw new Error('Point prompts support at most one box.');
}

export function segmentationConfig(bytes, dimensions, points, text, tokenType = 'spark', boxes = []) {
  if (!dimensions || !Number.isSafeInteger(dimensions.width) || !Number.isSafeInteger(dimensions.height)
    || dimensions.width < 256 || dimensions.height < 256 || dimensions.width > 2560 || dimensions.height > 2560
    || bytes.length > 24 * 1024 * 1024) throw new Error('Choose an original still under 24 MB, with each edge between 256 and 2560 pixels.');
  validateSegmentationPrompts(points, text, boxes);
  return {
    modelId: SAM3_MODEL_ID, positivePrompt: 'Select the indicated object.', negativePrompt: '',
    startingImage: bytes, sam3Prompt: { ...(points.length ? { points } : {}), ...(boxes.length ? { boxes } : {}), ...(text?.trim() ? { text: text.trim() } : {}), threshold: 0.5, multimask: points.length > 0 },
    ...dimensions, sizePreset: 'custom', numberOfMedia: 1, numberOfPreviews: 0, steps: 1, guidance: 1,
    outputFormat: 'png', disableNSFWFilter: false, tokenType, waitForCompletion: false,
  };
}
