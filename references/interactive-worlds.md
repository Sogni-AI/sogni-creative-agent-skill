# Building an interactive world

An end-to-end recipe for the kind of thing an agent can build alone with this
skill: an explorable world where a still image is a place, objects in it are
clickable, choosing one plays a rendered journey to somewhere else, characters
speak, each region has its own score, and some objects can be collected and
turned over in 3D.

Everything here is measured from a working build — three worlds, 24 scenes, 65
clickable objects, 80 retained masks, 72 crossings, 75 spoken moments, 8 music
cues and 10 collectible meshes — including the mistakes, because most of them
are not obvious and each one cost a day.

## The stack, in the order it runs

The direct CLI now covers this stack, including `--image-to-3d` for Pixal3D,
`--remove-background` for BiRefNet, `--music -m music3` for scores, and
`--speech --speech-mode clone` for character voices. Hosted tools and SDK
projects remain available. Read [models.md](./models.md) for the required
inputs and controls before converting a stage into commands.

| Step | Model | What it gives you |
|---|---|---|
| 1. Places | `krea2_turbo_fp8_scaled` | A scene as one wide still |
| 2. The same character, somewhere new | `krea2_identity_edit_v1_2` | A new place with a recognisable character in it, from two context references |
| 3. Clickable objects | `sam3_image_segment_bf16` | A pixel mask of a named object, to trace into a hit area |
| 4. Clean cut-outs | `birefnet_image_background_removal_fp16` | A soft matte with real edges, for anything going into 3D or a composite |
| 5. Travel and dialogue | `minimax-h3-fastvideo-int8_flf2v_turbo`, `minimax-h3-fl2va-fp8_flf2v_turbo` | First/last-frame video with generated audio in one pass |
| 6. Score | `minimax_music3` | A loopable instrumental cue per region |
| 7. Figures | `pixal3d_int8_i23d` (`pixal3d_multiview_int8_i23d` with side and back views) | A textured GLB from one image on transparency |
| 8. A character's own voice | `qwen3_tts_1.7b_voice_clone_bf16` | Any line spoken in a cloned voice |
| 9. A character speaking on camera | `wan_v2.2-14b-fp8_s2v_lightx2v` | Image plus audio to lip-synced video |

## The loop that makes it survivable

Do not call a model from application code. Every asset goes through four steps,
and the discipline is what lets a build of this size be resumed, audited and
trusted:

1. **Prepare.** Write the exact job — prompt, seed, references, sizes — to a
   plan file. Submit nothing. If a plan already exists, it must reproduce byte
   for byte, which is what stops a silent change to an input from invalidating
   what already shipped.
2. **Render.** Journal the submission *before* sending it. A job whose outcome
   is unknown must never be silently duplicated; a job with a *recorded* failure
   is a known outcome and may be retried. A completed item is never re-rendered.
3. **Verify natively.** Probe the returned file — frame counts, dimensions,
   audio channels, triangle counts, mask coverage, SHA-256. Models fail in ways
   that still return HTTP 200. Then look at it.
4. **Retain.** Publish to immutable, hash-addressed storage and write the
   receipt into a manifest. The app reads only the manifest, so it cannot ship
   an asset that was never verified.

## Stage notes, and what goes wrong

### Scenes

The scene still is the source of truth for everything downstream: masks are
traced against it, crossings are anchored on it, cut-outs come out of it. Keep
its exact bytes and its hash. Never re-save, re-crop or screenshot it, and never
substitute a frame extracted from a video for it — a mask traced against one
copy will not fit another.

### Where the character goes in the shot

**Do not put the character front, centre, large and looking at the camera.**
This is the easiest mistake to make and the hardest to undo, because it is
usually written once into a shared identity block and then inherited by every
scene in the world. One build asked for "this single mascot visibly present and
full-bodied, around one third of the picture height" and then added "stands
center foreground" to each scene on top of it. Twenty-odd scenes came back as
the same portrait with different wallpaper. Mark: "NEVER PLACE the main
character front and center looking at the viewer in every scene ... the main
character should move in depth and position and not take up so much of the
screen and not always be looking at the viewer."

Compose around the *place* and let the character be in it: off to one side,
well back in depth, small against the scale, seen from the back or three-
quarters, occupied with something, entering or leaving. Vary it scene to scene.
A large camera-facing foreground pose is a choice to make once, for the scene
where it is the point — never the default.

Identity and framing are separate instructions, and only the framing should
move. Keep every clause about fur, glasses, nose, horn and proportions exactly
as it is; a character whose placement varies is still the same character, and
loosening the identity to get variety costs the thing the world is built on.

### Keeping a character

A name is not an identity lock. `krea2_identity_edit_v1_2` accepts one or two
context images; for this workflow give it the world in one and the character in the
other, and say in the prompt which reference is for which. Everything a
character's identity depends on has to be in a saved reference image you can
hand back to the model.

### Clickable objects, and when to reach for the other model

Read the comparison in [`models.md`](./models.md) § Choosing between SAM 3 and
BiRefNet before writing either. In short: SAM 3 selects the object you name,
BiRefNet separates foreground from background, and neither does the other's job.

Four SAM 3 failures worth knowing before you spend anything:

- **It answers to a plain head noun.** `telescope` returns a mask; "a brass
  refracting telescope on a wooden tripod" returned nothing four times.
- **A box does not constrain a text prompt — it is another prompt.** Asking for
  `person` inside a box around one traveller also returned a stone giant lying
  across the valley, and every shopper in a market. When you mean *this* one,
  use points.
- **It is literal about where an object ends.** `sloth` gives you the animal and
  leaves the cloak, hood and backpack behind. `person` gives you the person and
  leaves the backpack they are wearing behind, so the silhouette has a hole
  through it.
- **`multimask` requires point prompts.** Sending it alongside text and boxes is
  rejected outright.

### Anything going into 3D

- **Cut it out with BiRefNet, not with a segmentation mask.** Segmentation edges
  are hard and stair-stepped and leave specks of background behind.
- **Do not downscale on the way in.** This is the single biggest quality lever
  and the easiest to miss. A pipeline that caps a cut-out's long side will
  quietly throw away a third of a portrait's pixels, and on a character that
  loss lands almost entirely on the face — melted glasses, a smeared muzzle. The
  same portrait, same mask, same recipe, fed at 1152px instead of 900px, was the
  difference between "looks like garbage" and shippable.
- **Ask for far fewer triangles than the default.** A browser wants 60,000, not
  700,000. Mesh weight is set by the face budget and texture sizes, *not* by the
  input resolution, so a bigger input costs nothing at runtime.
- **Parse the GLB rather than trusting it** — chunk table, glTF JSON, triangle
  and vertex counts, normals, UVs.
- **Give it the sides when you have them.** One image leaves Pixal3D guessing
  the back; `--image-to-3d front.png --left-view left.png --back-view back.png
  --right-view right.png` (any subset) uses `pixal3d_multiview_int8_i23d` at the
  same price. Name each view by the subject's own side: the left view shows it
  turned so its own left side faces the camera (facing screen-left). A
  turnaround template that labels the subject's right side "left" builds the
  model turned 180 degrees. (Not part of the measured build above.)

### Crossings between scenes

**Describe a journey, never a transformation.** This is the single biggest
quality lever on a crossing and it is easy to get wrong. Write "the cabin drops
down the cable, cloud tearing past the windows, until the platform slides into
frame" and you get travel. Write "the cloud thins into rainforest mist" or "the
street gives way to the hill" and you get a dissolve — the model reads
*becomes*, *gives way to*, *opens out into* as an instruction to blend, and no
amount of "no crossfade" elsewhere in the prompt will override a concrete
instruction to morph.

The tell that a crossing is about to fail is that the journey is *impossible*:
into a telescope barrel, into a phone earpiece, into a jukebox cabinet, through
a mirror, into a slot in a rack. With no space to move through, blending is all
the model has left. Give it real geography instead — go *around* rather than
*through*. A telescope crossing works if the camera climbs the barrel and keeps
going up through actual cloud to the observatory; it dissolves if it goes in at
the eyepiece.

The reliable trick for a crossing that really is a portal — under a basket lid,
into a diving bell — is to let the object physically swallow the lens. The lid
swings down across frame, it is dark for a beat, and the camera comes out the
other side. That is occlusion, which is travel, and it never reads as a fade.

Distance matters as much as wording. A crossing is about five seconds; asking
for rainforest canopy to open ocean to Manhattan in that time makes the model
stall and go to mush even when every verb is a travel verb. Cut the geography
until the move is one continuous gesture.

**No frame-statistics metric can detect a fade. Look at the clip.** This is
worth stating flatly because two plausible metrics were tried and both inverted:

- *Edge energy at the midpoint against the ends.* Reads as a softness detector,
  but fast camera travel with objects whipping past the lens produces real
  motion blur, which drops edge energy exactly as a dissolve does.
- *Correlating the middle against both ends and taking the lower.* Reads as a
  superimposition detector, but two scenes that simply look alike — two rainy
  streets — correlate highly with nothing blended, and a deliberate dark
  occlusion beat correlates with neither end while being exactly right.

Combining them does not help, because the occlusion the crossing wants — a lid
swinging over the lens, a bell going down into dark water, a turn into an
unlit stairwell — is, in frame statistics, indistinguishable from mush: a
middle that resembles neither end and carries little detail. Both rewrites
measured *worse* than the transformations they replaced and both were plainly
better on screen. Extract a strip of eight frames across the whole clip and
look at it. One picture smeared or blocked is travel; two pictures
superimposed is a fade. That judgement takes seconds and is the only one that
has been right.

Anchor first *and* last frame on the exact retained stills. That is what makes a
journey feel continuous instead of like a cut: the clip opens on the frame the
visitor was already looking at and lands on the one they are about to explore.

**Generated clips have exactly one keyframe.** A 192-frame crossing carries a
single I-frame at time zero. This has two consequences most people meet the hard
way:

- You cannot seek backwards through one. Seeking to frame 190 decodes 191
  frames, frame 189 decodes 190 — a reverse pass is roughly 96× the work of
  playing it forwards, measured at 260 ms per backward frame against a 41.7 ms
  budget. No amount of buffering, blob URLs or frame callbacks fixes it, because
  the cost is in the seek. **If you want a rewind, render the reverse ahead of
  time** (`ffmpeg -vf reverse`, and `areverse` for the sound) and play it
  forwards. That also gets you reversed audio, which seeking can never do.
- Anything that scrubs, thumbnails or previews these clips will be slow for the
  same reason.

### Dialogue

`minimax-h3-fl2va-fp8_flf2v_turbo` generates picture and sound together, holding
one still at both ends: the scene stays exactly as the visitor left it, breathes,
and is spoken over. That shape is also the safest available — a shot that never
changes distance cannot inflate a second copy of a subject into frame.

Two things to plan for:

- **It casts a new voice every time.** The same character will sound like a
  different person in every scene. If a character recurs, clone a voice
  (below) and plan from the start for how their lines get into the clips.
- **Loudness varies enormously between clips.** Measured across 74 clips in one
  build: a 25.5 dB spread, −39.5 dB to −14.0 dB mean. Two clips in the same
  scene were 18 dB apart, which is roughly an eighth of the perceived loudness —
  inaudible next to their neighbours. Normalise the set (EBU R128) rather than
  patching outliers.

### A recurring character's voice

`qwen3_tts_1.7b_voice_clone_bf16` takes three to thirty seconds of one person
speaking cleanly.

**Always pass `referenceText`** — the exact words of that recording. Without it
the model has only a speaker embedding and fills the rest in from its own prior:
a recording of a Singaporean toddler came back as a General American girl. With
the transcript it conditions on the recording itself. If your transcript was
produced automatically, check it by ear before using it; a mis-transcribed word
teaches the model the wrong sounds for those phonemes.

### A character who speaks on camera

If the character is *visible* while speaking, you cannot swap the audio — the
lips stay on the old rhythm. Regenerate with `wan_v2.2-14b-fp8_s2v_lightx2v`,
which takes one image and one audio track and animates the person in the image
to that audio. Feed it the frame where the character is already standing in the
scene, so the new clip starts where the story left them.

On MiniMax H3 the same job is FastH3 audio-to-video:
`-m minimax-h3-fasth3-ia2v-turbo --ref frame.png --ref-audio line.wav` animates
from that frame to the uploaded line and keeps it as the soundtrack, and
`minimax-h3-fasth3-flfa2v-turbo` adds `--ref-end` to land on a known last frame.
Write the spoken words inside the prompt's `<d>` tag. No LoRAs load on these
modes. (Not part of the measured build above.)

If the character is *never seen* — written as a voice, which is worth doing
deliberately for most of a cast — their clips need no regeneration at all.

Note the id: `wan_v2.2-14b-fp8_s2v` is not currently accepted by the client's
video-model allowlist even though workers advertise it; the `_lightx2v` variant
is, and routes.

### Score

One cue per region, generated long enough to loop, crossfaded on movement and
ducked under anything that has its own audio.

## Two things about pacing an agent build

- **Canary before batch.** One line, one clip, one mesh — verified natively and
  approved — before spending on the set. Every expensive mistake in this build
  was a batch that should have been a canary.
- **A queued job is not a failed job.** Newly seeded models can have very few
  workers, and a job may sit behind other people's work. Adding a client-side
  timeout and resubmitting only duplicates work that was always going to
  complete.
