# Personas, Memory & Personality

Read this when managing personas (named people with saved reference photos and
voice clips), persistent user preferences, custom agent personality, or
multi-persona scenes.

## Persona System

Personas enable identity-preserving generation across sessions. Stored at
`~/.config/sogni/personas/`.

### Managing Personas

```bash
# Add a persona with a reference photo
sogni-agent --persona-add "Mark" --ref face.jpg --relationship self --description "30s male, brown hair, brown eyes"

# Add with voice clip for video voice cloning (plus a voice description)
sogni-agent --persona-add "Sarah" --ref sarah.jpg --relationship partner --voice-clip sarah-voice.webm --voice "warm alto with British accent"

# List all personas
sogni-agent --persona-list --json

# Resolve a persona by name, tag, or pronoun
sogni-agent --persona-resolve "me" --json

# Generate using a persona (auto-injects photo as context)
sogni-agent --persona "Mark" -o ./hero.png "superhero in dramatic lighting"

# Video using a persona photo + saved voice identity
sogni-agent --video --persona "Sarah" 'SARAH: "This is my voice."'

# Remove a persona
sogni-agent --persona-remove "Mark"
```

`--relationship` accepts `self|partner|child|friend|pet` (default `friend`).

### Persona Pipeline Rules

When a user mentions a persona by explicit saved name, id, or tag/alias:

1. **For images:** use `--persona "Name" "prompt"` — auto-injects the persona's reference photo as context and selects the Qwen editing model.
2. **For video with voice cloning:** the persona's voice clip is used as `--reference-audio-identity` automatically when `--video` is combined with `--persona`. `--voice-persona <name>` selects just the voice identity.
3. **For video without a voice clip:** describe the voice in the prompt ("speaks in a warm alto with a British accent").

**Important:** user-uploaded photos are NOT personas. Only use `--persona`
when referring to a saved persona by explicit name, id, or tag/alias;
relationship phrases alone are not persona identifiers. For ad-hoc photos,
use `-c` (context image) directly.

### Multi-Persona Scene

1. Resolve all personas: `--persona-resolve "Mark" --json` and `--persona-resolve "Sarah" --json`
2. Generate the scene with both photos: `-c mark-photo.jpg -c sarah-photo.jpg "Mark and Sarah at a cafe, use face from picture 1 for Mark, face from picture 2 for Sarah"`
3. Animate with one persona's voice identity: `--video --ref <scene.png> --reference-audio-identity <mark-voice.webm> "MARK: \"Exact spoken words.\""`

## Memory System (persistent preferences)

Memories are persistent key-value preferences stored at
`~/.config/sogni/memories.json`.

```bash
sogni-agent --memory-set preferred_style "watercolor and soft lighting"
sogni-agent --memory-set aspect_ratio "16:9"
sogni-agent --memory-set favorite_artist "Studio Ghibli"
sogni-agent --memory-list --json
sogni-agent --memory-get preferred_style --json
sogni-agent --memory-remove preferred_style
```

**Agent behavior:** before generating, check memories with `--memory-list` and
respect saved preferences. If the user says "I always want watercolor style",
save it with `--memory-set`. Categories via `--memory-category`: `preference`
(default), `fact`, `context`.

## Personality (custom agent instructions)

Custom instructions that shape agent behavior, stored at
`~/.config/sogni/personality.txt`.

```bash
sogni-agent --personality-set "Be concise, always use cinematic lighting, suggest bold creative ideas"
sogni-agent --personality-get --json
sogni-agent --personality-clear
```

**Agent behavior:** check personality on startup and adopt those instructions.
Personality overrides default style but not hard constraints (safety, tool
usage rules).

## Style Transfer recipes

```bash
# Apply a named artist style
sogni-agent -c photo.jpg -o ./styled.png "Apply style: Andy Warhol pop art with bold primary colors"

# Studio Ghibli transformation
sogni-agent -c photo.jpg -o ./ghibli.png "Apply style: Studio Ghibli watercolor with soft pastel sky and lush greenery"

# For photos with people, always preserve identity
sogni-agent -c portrait.jpg -o ./styled.png "Apply style: oil painting in the style of Vermeer. Preserve all facial features, expressions, and identity."
```

**Tips:** reference artists and styles BY NAME for best results. Use positive
phrasing. For photos with people, always append identity-preservation
instructions.

## Photo Restoration recipes

```bash
# Basic restoration
sogni-agent -c damaged_photo.jpg -o restored.png \
  "professionally restore this vintage photograph, remove damage and scratches"

# Detailed restoration with preservation hints
sogni-agent -c old_photo.jpg -o restored.png -w 1024 -h 1280 \
  "restore this vintage photo, remove peeling, tears and wear marks, \
  preserve natural features and expression, maintain warm nostalgic color tones"
```

**Tips:** describe the damage ("peeling", "scratches", "tears", "fading");
specify what to preserve ("natural features", "eye color", "expression");
mention the era for color tones ("1970s warm tones", "vintage sepia").
