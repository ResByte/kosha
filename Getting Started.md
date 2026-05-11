---
tags: [welcome, tutorial]
created: 2026-02-25T00:00:00Z
---

# Welcome to Kosha

**कोश** — Sanskrit for "treasury". A minimal personal knowledge keeper for macOS.

## Live Rendering

Type Markdown, and it renders *in-place*. Move your cursor onto any formatted element to edit the raw syntax.

## Keyboard Shortcuts

| Action | Shortcut |
|---|---|
| Quick switcher | `Cmd+K` |
| Full-text search | `Cmd+Shift+F` |
| New note | `Cmd+N` |
| Toggle sidebar | `Cmd+B` |
| Toggle source / live | `Cmd+/` |
| Toggle dark theme | `Cmd+Shift+T` |
| Manual save | `Cmd+S` |

## Code Blocks

```python
def greet(name: str) -> str:
    """Return a greeting."""
    return f"Hello, {name}!"

print(greet("world"))
```

```typescript
const add = (a: number, b: number): number => a + b;
console.log(add(1, 2));
```

## Math

Inline: $E = mc^2$ and $\pi \approx 3.14159$

Block:

$$\int_0^\infty e^{-x^2}\, dx = \frac{\sqrt{\pi}}{2}$$

## Checkboxes

- [x] Install the app
- [ ] Create your first note (`Cmd+N`)
- [ ] Try `[[wiki-links]]` between notes
- [ ] Run a full-text search (`Cmd+Shift+F`)

## Blockquote

> A note-taking app should get out of your way. Kosha renders Markdown in-place so you can focus on writing.

## Wiki Links

Navigate between notes: [[Kosha Features]]

---

Notes live in `~/.kosha-data/` as plain `.md` files — portable and future-proof.
