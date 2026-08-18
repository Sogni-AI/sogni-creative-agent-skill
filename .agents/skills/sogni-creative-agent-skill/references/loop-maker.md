# Loop Maker: Image Folder to Seamless Music-Backed Video

Use this workflow for one-command requests to turn a folder of still images into a fast, polished, seamlessly looping video. It differs from the default SourceReel pipeline: render one direct first-frame/last-frame LTX clip per adjacent image pair instead of creating a standalone animation clip plus a bridge. The skill invocation is the one command; the agent performs the audited render, retries, assembly, and verification behind it.

## Defaults and rendering stack

- Preserve source files and their relative filename order.
- Support `.jpg`, `.jpeg`, `.png`, and `.webp` source images.
- Keep one strongest representative of each visual concept.
- Use the strongest retained image as the opener unless the user names another, then rotate the ordered list without otherwise reordering it.
- Render one 3-second clip per image pair: about 2 seconds of restrained motion followed by a smooth transition into the next supplied image.
- Close the loop with the last retained image to the opener.
- Use `ltx25-22b-int8_i2v_distilled`, `--token-type auto`, and the exact original files as both `--ref` and `--ref-end` for every pair.
- Pin both endpoint strengths to `1` and disable SDK asset auto-resizing after choosing a valid LTX canvas.
- Target a 768px short side unless the user requests another resolution. Choose dimensions divisible by 64, preserve the dominant source aspect ratio, and keep the long side at or below 2048px. For a 4:3 source set, use `1024x768`.
- Normalize the stitched result to 32 fps.
- Generate instrumental ACE-Step 1.5 XL Turbo music unless the user supplies audio or requests `music=none`.
- Save the final beside the source folder as `sogni-loop-final.mp4`, choosing a non-overwriting numbered name when it already exists.

The default stack is Sogni generation plus the Sogni CLI's local FFmpeg wrappers. Do not initialize or depend on HyperFrames or Remotion for generation, assembly, or validation. If either compositor is already installed, use it only when the user explicitly asks for timed text, titles, overlays, or effects that the wrappers cannot provide; preserve the approved picture track and loop anchors through that optional pass.

## 1. Resolve input and preferences

Parse the invocation text for:

- source folder;
- optional opening image;
- optional output path;
- optional music style or `music=none`;
- optional clip duration, resolution, aspect ratio, fps, ordering, or compositor effects.

Use the current directory only when no folder was supplied and it clearly contains the intended source set. Ask one concise question only when the folder cannot be resolved safely.

Before generation, run:

```bash
sogni-agent --memory-list --json
sogni-agent --personality-get --json
```

Respect explicit invocation preferences over stored defaults. Do not run `doctor` as a routine preflight.

## 2. Audit and deduplicate visually

Inspect every candidate image as pixels, not just filenames, metadata, hashes, or thumbnails too small to judge. Group together:

- byte-identical files;
- alternate exports, crops, or edits of the same scene;
- images with substantially repeated subject, wardrobe, setting, composition, and concept;
- sketches, unfinished work, corrupted files, obvious mistakes, and low-quality outliers.

Keep the strongest image from each group. Prefer the first occurrence when alternatives are equivalent. Preserve retained images' relative filename order, then rotate the list to the chosen opener. Never delete, overwrite, recompress, or substitute an original source image.

Write a small plan that records the selected order, exclusions with reasons, opener, adjacent pairs including last-to-first, output path, model, dimensions, fps, and music direction. If fewer than two unique suitable images remain, stop and explain why a multi-image loop cannot be built.

## 3. Render one anchored clip per pair

For selected images `A, B, C`, render exactly:

```text
A -> B
B -> C
C -> A
```

Do not render standalone image-animation clips, extra bridge clips, or multi-angle stills. This one-clip-per-pair structure prevents a scene from appearing twice.

For each pair, write one LTX-safe paragraph of 4-8 present-tense sentences:

1. Establish the supplied starting image and its concrete visual identity.
2. Describe restrained, believable motion for roughly the first two seconds.
3. Connect shared lighting, color, texture, shapes, atmosphere, or camera movement into the supplied target image.
4. State that the shot settles exactly into the supplied final image with stable identity, wardrobe, style, and composition.

Keep one continuous shot and one motion thread. Use positive phrasing. Preserve faces, bodies, clothing, layout, magazine covers, and important source text. Do not request new on-screen text, logos, anatomy, props, or intermediate scenes.

Describe ambiguous source objects with concrete positive geometry and material language. For example, call a saddle horn “one compact rounded inanimate leather saddle horn” instead of merely warning against an animal; this reduces accidental anatomy while keeping prompts positive.

Pass the exact original paths directly. Do not make normalized JPEG copies or use generated angle images as anchors:

```bash
sogni-agent -q --video \
  -m ltx25-22b-int8_i2v_distilled \
  --ref ./from-image.jpg \
  --ref-end ./to-image.jpg \
  --no-auto-resize-assets \
  --first-frame-strength 1 --last-frame-strength 1 \
  -w <width> -h <height> \
  --duration 3 --token-type auto -t 600 \
  -o ./working/clips/01-to-02.mp4 \
  "<four-to-eight-sentence LTX transition paragraph>"
```

The explicit no-auto-resize setting is intentional. In testing, requesting a 4:3 high-resolution canvas while leaving SDK asset auto-resizing enabled produced an unintended second resize and a `1408x1152` result; `--no-auto-resize-assets -w 1024 -h 768` preserved the intended 4:3 output. Verify the actual clip dimensions instead of trusting only the requested values.

Render independent pairs with at most two concurrent jobs when the host can track each job and preserve per-clip errors. Keep every approved clip as a frozen local file.

### True 360 requests are a separate, unvalidated workflow

Do not advertise or label a direct single-image LTX transition as a 360 orbit. A real trial using pairwise LTX orbit prompts produced fixed-camera pose changes, hat and sheet wipes, and ordinary morphs; it did not produce sustained camera travel, coherent rear-view geometry, or background parallax.

When the user requests a true 360 wraparound, explain that Loop Maker's validated path is the anchored morph loop, not single-image novel-view synthesis. Proceed only when the user supplies coherent multi-view sources or explicitly authorizes a separate experimental angle-synthesis workflow such as `--angles-360 --angles-360-video`. That workflow generates additional intermediate views and clips, so it is not equivalent to the one-original-per-pair contract and must be audited separately.

Never count a turning subject, changing pose, zoom, crop, wipe, or morph as a camera orbit. Accept a 360 result only when sampled frames demonstrate consistent front, quarter, side, rear, opposite-side, and return viewpoints, with coherent background parallax and stable identity. If those tests fail, report that the orbit failed; do not describe the output as 360.

## 4. Verify every clip before assembly

Extract both anchors and interior checkpoints with the safe wrappers. For a 3-second clip:

```bash
sogni-agent --extract-first-frame ./working/clips/01-to-02.mp4 ./working/verify/01-to-02-first.png
sogni-agent --extract-frame-at ./working/clips/01-to-02.mp4 0.75 ./working/verify/01-to-02-25.png
sogni-agent --extract-frame-at ./working/clips/01-to-02.mp4 1.50 ./working/verify/01-to-02-50.png
sogni-agent --extract-frame-at ./working/clips/01-to-02.mp4 2.25 ./working/verify/01-to-02-75.png
sogni-agent --extract-last-frame ./working/clips/01-to-02.mp4 ./working/verify/01-to-02-last.png
```

For other durations, sample roughly 25%, 50%, and 75%. Visually compare all five frames with the intended originals. Compression means endpoint pixels need not be byte-identical, but the first and last frames must perceptually match the exact supplied anchors.

Approve a clip only when:

- the first frame is the intended starting original;
- the last frame is the intended target original;
- interior motion is coherent and reaches the target rather than an invented scene;
- any requested camera movement is visible in viewpoint and background parallax rather than simulated by subject rotation or an occluder wipe;
- no unrelated or duplicate scene, face, body, animal, text, or prop appears;
- identity, wardrobe, and important composition remain stable;
- actual dimensions and orientation match the plan.

Regenerate a failing clip with a more concrete pair-specific prompt. Preserve the same source pair and output dimensions. Name failed attempts separately and limit automatic retries to two per pair. If it still fails, keep any prior verified final untouched and report the failed pair.

## 5. Stitch exactly once

Concatenate approved pair clips in planned order, once each:

```bash
sogni-agent --concat-videos ./working/picture-only.mp4 \
  ./working/clips/01-to-02.mp4 \
  ./working/clips/02-to-03.mp4 \
  ./working/clips/03-to-01.mp4 \
  --concat-fps 32
```

The opener may appear at the first and final boundary only to close the loop. No retained concept or transition clip may otherwise repeat.

## 6. Create and apply music

If the user supplies music, use that frozen local file. If the user requests `music=none`, keep the picture-only output. Otherwise derive a coherent instrumental style from the images. When no direction is given, use subtle melodic electronic music with eclectic tropical and futuristic accents, polished atmosphere, light rhythm, warm texture, and restrained energy.

Generate ACE-Step 1.5 XL Turbo music at least 6 seconds longer than the stitched picture:

```bash
sogni-agent -q --token-type auto --music --music-model turbo \
  --duration <video-seconds-plus-6-or-more> \
  -o ./working/soundtrack.mp3 \
  "<instrumental music direction>"
```

Apply it without looping and align fades to the actual video ending:

```bash
sogni-agent --remix-audio ./working/picture-only.mp4 ./sogni-loop-final.mp4 \
  --bed-audio ./working/soundtrack.mp3 \
  --audio-fade-in 0.35 --audio-fade-out 1.4
```

Treat music generation as recoverable but never silently weaken the output contract. If a worker fails server-side, run `doctor` only after that failure, retry once, and reuse a previously generated soundtrack only when it is verified, stylistically suitable, and longer than the picture. Do not silently loop a short track or let it end early. If no valid track exists, preserve the approved picture-only assembly and report the music stage as incomplete instead of presenting it as the requested final.

## 7. Final verification, cleanup, and handoff

Extract and visually compare the final first and last frames, then verify streams and a full decode:

```bash
sogni-agent --extract-first-frame ./sogni-loop-final.mp4 ./working/verify/final-first.png
sogni-agent --extract-last-frame ./sogni-loop-final.mp4 ./working/verify/final-last.png
sogni-agent --verify-video ./sogni-loop-final.mp4 --json
```

Confirm that:

- every retained visual concept appears once;
- every approved transition clip appears once;
- all adjacent pairs use the correct original first and last frames;
- the final boundary perceptually matches the opening original;
- size and fps are consistent;
- the soundtrack is longer than and covers the complete picture without looping;
- the final MP4 contains valid video and audio streams unless `music=none` was requested;
- the entire file decodes successfully.

Only after the final passes, move generated failed clips, obsolete assemblies, superseded finals, and disposable verification stills to Trash so they remain recoverable. Preserve original images, the final output, the soundtrack, the plan, and approved clips unless the user explicitly requests deeper cleanup.

Return a clickable absolute path to the final video plus duration, dimensions, fps, unique-scene count, music status, and any excluded-image summary.
