"""Gemini / NotebookLM chat model presets for GenerateFreeFormStreamed (param index 3).

The official notebooklm-py client sends ``[2, None, [1], [1]]``. Other tuples are
best-effort mappings; if Google changes the API, adjust here. Unknown keys fall
back to ``default``.
"""

from __future__ import annotations

from typing import Any, TypedDict


class GeminiChatModelInfo(TypedDict):
    id: str
    label: str
    description: str


# Fourth element of the JSON params array (see notebooklm._chat.ChatAPI.ask).
_GEMINI_OPTIONS: dict[str, list[Any]] = {
    # Matches notebooklm-py exactly.
    "default": [2, None, [1], [1]],
    # Experimental: nested indices may map to faster / more capable routing.
    "fast": [2, None, [2], [1]],
    "pro": [2, None, [1], [2]],
}


def list_gemini_chat_models() -> list[GeminiChatModelInfo]:
    return [
        {
            "id": "default",
            "label": "Predeterminado (NotebookLM)",
            "description": "Mismo comportamiento que la app oficial con notebooklm-py.",
        },
        {
            "id": "fast",
            "label": "Rápido",
            "description": "Variante experimental orientada a respuestas más ágiles.",
        },
        {
            "id": "pro",
            "label": "Más capacidad",
            "description": "Variante experimental orientada a respuestas más elaboradas.",
        },
    ]


def resolve_gemini_model_options(model_id: str | None) -> list[Any]:
    """Return API options tuple for the given preset id."""
    key = (model_id or "default").strip().lower()
    if key not in _GEMINI_OPTIONS:
        valid = ", ".join(sorted(_GEMINI_OPTIONS))
        raise ValueError(f"gemini_model desconocido: {model_id!r}. Valores: {valid}")
    return list(_GEMINI_OPTIONS[key])
