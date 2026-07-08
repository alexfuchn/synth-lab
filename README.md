# SYNTH\_LAB

A browser-based waveform synthesizer that turns **math expressions into sound** in real time.

[Live Demo](#) (add your GitHub Pages / Vercel link here)

---

## Why this exists

Most web audio toys give you knobs and sliders. SYNTH\_LAB gives you a **text input**. Type any function `f(x)` — where `x` is time in seconds — and hear it instantly. It's a playground for anyone curious about the math behind sound: harmonics, FM synthesis, beats, envelopes, and more.

## Features

### Mode 1 — FUNCTION (math expression)

- Type an arbitrary function of `x` (time) and **hear it rendered as audio**
- Built-in math keyboard: `sin`, `cos`, `tan`, `ln`, `log`, `exp`, `sqrt`, `abs`, `^`, `PI`, `E`
- Presets to get started: pure sine, overtone stack, exponential decay, FM synth, tremolo, gated
- **Undo / Redo** history (`Ctrl+Z` / `Ctrl+Y`)
- **Favorites** (persisted in `localStorage`, `Ctrl+B` to bookmark)
- Expression safety sandbox — blocks `eval`, `Function`, `fetch`, and other dangerous patterns

### Mode 2 — WAVE\_MIX (4-wave mixer)

- Mix four classic waveforms: sine, triangle, sawtooth, square
- Independent controls per wave: **Amplitude**, **Frequency** (20–2000 Hz), **Phase** (0–2π)
- Global K-coefficient mixer: `k₁·SIN + k₂·TRI + k₃·SAW + k₄·SQR`

### Visualizations

- **Circular waveform ring** — gradient stroke + dynamic glow, reacts to RMS volume
- **Scrolling oscilloscope** — fade-from-right gradient, real-time waveform trace
- **Real-time frequency estimation** — zero-crossing detection in function mode
- **Peak indicator** + **clipping warning**

## Tech Stack

Zero dependencies. Plain HTML, CSS, and JavaScript.

- **Web Audio API** — `ScriptProcessorNode` for per-sample synthesis
- **Canvas 2D** — 60 fps ring visualizer and oscilloscope
- **CSS custom properties** — dark synthwave theme with cyan/magenta/gold palette
- **`new Function()`** — safe expression compilation with blocklist validation

## Project Structure

```
synth-lab/
├── index.html      # UI layout (290 lines)
├── styles.css      # Dark synthwave theme (706 lines)
├── script.js       # Audio engine + visuals + UI logic (804 lines)
└── README.md
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play / Stop |
| `Ctrl+Z` | Undo expression |
| `Ctrl+Y` | Redo expression |
| `Ctrl+B` | Bookmark / unbookmark |
| `Enter` | Apply expression |

## Example Expressions

Try these in **FUNCTION mode**:

| Expression | What you hear |
|------------|---------------|
| `sin(440*2*PI*x)` | Pure 440 Hz sine (A4) |
| `sin(440*2*PI*x)+0.3*sin(880*2*PI*x)` | Fundamental + 1st harmonic |
| `exp(-3*x)*sin(440*2*PI*x)` | Exponential decay envelope |
| `sin(220*2*PI*x+sin(5*2*PI*x))` | FM synthesis — vibrato siren |
| `sin(440*2*PI*x)*sin(0.5*2*PI*x)` | Tremolo (amplitude modulation) |
| `sin(440*2*PI*x)*(1-2*(x%0.5>0.25))` | Gated / pulse-width modulation |

## Getting Started

Clone and open — no build step, no package manager:

```bash
git clone https://github.com/your-username/synth-lab.git
cd synth-lab
open index.html   # or double-click in file explorer
```

Or serve it locally:

```bash
npx serve synth-lab
# or
python -m http.server 8000
```

> **Note:** Browsers require a user gesture to start `AudioContext`. Click anywhere on the page or press the PLAY button.

## Browser Support

Any modern browser with Web Audio API support: Chrome, Firefox, Edge, Safari.

## License

MIT
