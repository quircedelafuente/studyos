#!/usr/bin/env python3
"""
Genera src/app/dark-overrides.css.

Parte de un hecho: ~20% de la interfaz usa colores fijos de Tailwind en vez de
los tokens del tema, y en modo oscuro esos quedan como chips claros con texto
oscuro. Este script recorre las clases de color que REALMENTE se usan en src/,
lee la paleta real de la Tailwind instalada (oklch) y emite el equivalente
oscuro de cada una.

Se ejecuta a mano cuando cambien los colores de la interfaz:
    python3 scripts/gen-dark-overrides.py
"""
import re, math, collections, subprocess, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SURFACE_HEX = "#101010"   # debe coincidir con --surface de [data-theme="dark"]
BORDER_HEX = "#262626"    # idem con --border
NEUTRALS = {"slate", "gray", "zinc", "neutral", "stone"}

CLASS_RE = r"(bg|text|border|ring|shadow|from|via|to)-(white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(-[0-9]{2,3})?(/[0-9]{1,3})?"


def oklch_to_rgb(L, C, H):
    h = math.radians(H)
    a, b = C * math.cos(h), C * math.sin(h)
    l, m, s = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, (
        L - 0.1055613458 * a - 0.0638541728 * b
    ) ** 3, (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
    r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
    g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
    bl = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s

    def enc(x):
        x = max(0.0, min(1.0, x))
        return 12.92 * x if x <= 0.0031308 else 1.055 * (x ** (1 / 2.4)) - 0.055

    return tuple(enc(v) for v in (r, g, bl))


def hexs(rgb):
    return "#%02x%02x%02x" % tuple(round(max(0, min(1, c)) * 255) for c in rgb)


def hex2rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i : i + 2], 16) / 255 for i in (0, 2, 4))


def mix(c1, c2, t):
    return tuple(c1[i] * t + c2[i] * (1 - t) for i in range(3))


def load_palette():
    css = (ROOT / "node_modules/tailwindcss/theme.css").read_text()
    pal = {}
    for m in re.finditer(
        r"--color-([a-z]+)-(\d+):\s*oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)\)", css
    ):
        hue, shade, L, C, H = m.groups()
        pal[(hue, int(shade))] = oklch_to_rgb(float(L) / 100, float(C), float(H))
    return pal


def used_classes():
    out = subprocess.run(
        ["grep", "-rohE", CLASS_RE, str(ROOT / "src"), "--include=*.tsx"],
        capture_output=True, text=True,
    ).stdout
    return sorted(set(out.split()))


GRADIENT_KINDS = ("from", "via", "to")

# Escalas oscuras de Radix Colors (@radix-ui/colors 3.0.0), copiadas literales.
# Son escalas diseñadas para tema oscuro: cada paso tiene un papel fijo y los
# pasos 11 y 12 garantizan contraste sobre los fondos 2-3 de su propia escala.
# https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale
RADIX_DARK = {
    "red": {1: "#191111", 2: "#201314", 3: "#3b1219", 4: "#500f1c", 5: "#611623", 6: "#72232d", 7: "#8c333a", 8: "#b54548", 9: "#e5484d", 10: "#ec5d5e", 11: "#ff9592", 12: "#ffd1d9"},
    "amber": {1: "#16120c", 2: "#1d180f", 3: "#302008", 4: "#3f2700", 5: "#4d3000", 6: "#5c3d05", 7: "#714f19", 8: "#8f6424", 9: "#ffc53d", 10: "#ffd60a", 11: "#ffca16", 12: "#ffe7b3"},
    "grass": {1: "#0e1511", 2: "#141a15", 3: "#1b2a1e", 4: "#1d3a24", 5: "#25482d", 6: "#2d5736", 7: "#366740", 8: "#3e7949", 9: "#46a758", 10: "#53b365", 11: "#71d083", 12: "#c2f0c2"},
    "teal": {1: "#0d1514", 2: "#111c1b", 3: "#0d2d2a", 4: "#023b37", 5: "#084843", 6: "#145750", 7: "#1c6961", 8: "#207e73", 9: "#12a594", 10: "#0eb39e", 11: "#0bd8b6", 12: "#adf0dd"},
    "blue": {1: "#0d1520", 2: "#111927", 3: "#0d2847", 4: "#003362", 5: "#004074", 6: "#104d87", 7: "#205d9e", 8: "#2870bd", 9: "#0090ff", 10: "#3b9eff", 11: "#70b8ff", 12: "#c2e6ff"},
    "violet": {1: "#14121f", 2: "#1b1525", 3: "#291f43", 4: "#33255b", 5: "#3c2e69", 6: "#473876", 7: "#56468b", 8: "#6958ad", 9: "#6e56cf", 10: "#7d66d9", 11: "#baa7ff", 12: "#e2ddfe"},
}

# Cada familia de Tailwind cae en la escala de Radix que conserva su significado:
# rojo = error, ámbar = aviso, verde = éxito, azul = información.
HUE_TO_RADIX = {
    "red": "red", "rose": "red", "pink": "red", "fuchsia": "violet",
    "orange": "amber", "amber": "amber", "yellow": "amber",
    "lime": "grass", "green": "grass", "emerald": "grass",
    "teal": "teal", "cyan": "teal",
    "sky": "blue", "blue": "blue",
    "indigo": "violet", "violet": "violet", "purple": "violet",
}

ARBITRARY_RE = r"(bg|text|border|ring)-\[#[0-9a-fA-F]{3,8}\]"


def arbitrary_classes():
    """Clases tipo `bg-[#fffafa]`, que no salen de la paleta de Tailwind."""
    out = subprocess.run(
        ["grep", "-rohE", ARBITRARY_RE, str(ROOT / "src"), "--include=*.tsx"],
        capture_output=True, text=True,
    ).stdout
    return sorted(set(out.split()))


def readable_on(neon_hex, bg_rgb):
    """El neón, aclarado lo justo para cumplir contraste AA sobre su chip."""
    import colorsys

    r, g, b = hex2rgb(neon_hex)
    h, l0, s = colorsys.rgb_to_hls(r, g, b)
    for L in [x / 100 for x in range(int(l0 * 100), 96)]:
        cand = colorsys.hls_to_rgb(h, L, s)
        if contrast_ratio(cand, bg_rgb) >= 4.5:
            return hexs(cand)
    return hexs(colorsys.hls_to_rgb(h, 0.95, s))


def contrast_ratio(c1, c2):
    a, b = sorted([relative_luminance(c1), relative_luminance(c2)], reverse=True)
    return (a + 0.05) / (b + 0.05)


def relative_luminance(rgb):
    def f(c):
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = (f(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def esc(c):
    return (
        c.replace("/", r"\/")
        .replace(".", r"\.")
        .replace("[", r"\[")
        .replace("]", r"\]")
        .replace("#", r"\#")
    )


def main():
    pal = load_palette()
    surface, border = hex2rgb(SURFACE_HEX), hex2rgb(BORDER_HEX)
    rules = []
    for cls in used_classes():
        m = re.match(r"(bg|text|border|ring|shadow|from|via|to)-([a-z]+)(?:-(\d{2,3}))?(?:/(\d+))?$", cls)
        if not m:
            continue
        kind, hue, shade = m.group(1), m.group(2), m.group(3)
        sel = f'[data-theme="dark"] .{esc(cls)}'
        if hue == "white":
            if kind in GRADIENT_KINDS:
                rules.append((sel, f"--tw-gradient-{kind}", "var(--surface)"))
            elif kind == "bg":
                rules.append((sel, "background-color", "var(--surface)"))
            elif kind == "border":
                rules.append((sel, "border-color", "var(--border)"))
            elif kind == "ring":
                rules.append((sel, "--tw-ring-color", "var(--border)"))
            continue
        if hue == "black":
            # Los negros translúcidos se usan como líneas y separadores sobre
            # fondo claro: sobre negro desaparecen, así que se invierten. Los
            # opacos (scrims de modal) se dejan, que ahí siguen valiendo.
            alpha = int(m.group(4).lstrip("/")) if m.group(4) else 100
            if kind == "bg" and alpha <= 30:
                rules.append((sel, "background-color", f"rgba(255,255,255,{alpha / 100:.2f})"))
            elif kind == "border":
                rules.append((sel, "border-color", "var(--border-strong)"))
            elif kind == "ring" and alpha <= 30:
                rules.append((sel, "--tw-ring-color", f"rgba(255,255,255,{alpha / 100:.2f})"))
            continue
        s = int(shade or 500)
        if hue in NEUTRALS:
            if kind in GRADIENT_KINDS:
                v = "var(--surface-muted)" if s <= 200 else "var(--surface)"
                rules.append((sel, f"--tw-gradient-{kind}", v))
            elif kind == "bg":
                v = "var(--surface-muted)" if s <= 200 else ("var(--surface)" if s <= 400 else "var(--ink-faint)")
                rules.append((sel, "background-color", v))
            elif kind == "text":
                v = "var(--ink)" if s >= 700 else ("var(--ink-muted)" if s >= 400 else "var(--ink-faint)")
                rules.append((sel, "color", v))
            elif kind in ("border", "ring"):
                rules.append((sel, "border-color" if kind == "border" else "--tw-ring-color", "var(--border)"))
            continue
        scale = RADIX_DARK.get(HUE_TO_RADIX.get(hue, ""))
        if not scale:
            continue
        # Cada paso de Radix tiene un papel asignado:
        #   3  fondo de componente     6/7  borde     11/12  texto
        if kind in GRADIENT_KINDS:
            # Las paradas de gradiente NO son background-color: van por variable.
            rules.append((sel, f"--tw-gradient-{kind}", scale[2 if s <= 100 else 3]))
        elif kind == "bg":
            # Incluidos los fondos sólidos (bg-red-600): en oscuro un relleno
            # saturado deslumbra y deja el texto blanco pegado al límite.
            rules.append((sel, "background-color", scale[3 if s <= 300 else 4]))
        elif kind == "text":
            rules.append((sel, "color", scale[12 if s >= 800 else 11]))
        elif kind in ("border", "ring"):
            prop = "border-color" if kind == "border" else "--tw-ring-color"
            rules.append((sel, prop, scale[6 if s <= 300 else 7]))
        elif kind == "shadow":
            # Sombras de color: sobre negro se ven como halos sucios.
            rules.append((sel, "--tw-shadow-color", "transparent"))

    # ── Clases con valor arbitrario: bg-[#fffafa], text-[#111], border-[#eee] ──
    # No las cubre la paleta de Tailwind, así que se clasifican por luminancia:
    # lo muy claro pasa a superficie oscura, lo muy oscuro a tinta clara.
    for cls in arbitrary_classes():
        m = re.match(r"(bg|text|border|ring)-\[#([0-9a-fA-F]{3,8})\]$", cls)
        if not m:
            continue
        kind, raw = m.groups()
        if len(raw) == 3:
            raw = "".join(c * 2 for c in raw)
        rgb = hex2rgb("#" + raw[:6])
        L = relative_luminance(rgb)
        sel = f'[data-theme="dark"] .{esc(cls)}'
        if kind == "bg":
            if L > 0.75:
                rules.append((sel, "background-color", "var(--surface)"))
            elif L > 0.45:
                rules.append((sel, "background-color", "var(--surface-muted)"))
        elif kind == "text":
            if L < 0.25:
                rules.append((sel, "color", "var(--ink)"))
            elif L < 0.5:
                rules.append((sel, "color", "var(--ink-muted)"))
        elif kind in ("border", "ring"):
            if L > 0.6:
                prop = "border-color" if kind == "border" else "--tw-ring-color"
                rules.append((sel, prop, "var(--border)"))

    by = collections.OrderedDict()
    for sel, prop, val in rules:
        by.setdefault((prop, val), []).append(sel)

    out = ["/* GENERADO — no editar a mano. Ver scripts/gen-dark-overrides.py */", ""]
    for (prop, val), sels in by.items():
        out.append(",\n".join(sels) + " {")
        out.append(f"  {prop}: {val} !important;")
        out.append("}")
    (ROOT / "src/app/dark-overrides.css").write_text("\n".join(out) + "\n")
    print(f"{len(rules)} clases -> {len(by)} declaraciones")


if __name__ == "__main__":
    main()
