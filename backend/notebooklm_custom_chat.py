"""Chat ask with configurable GenerateFreeFormStreamed options (Gemini routing).

Duplicated from notebooklm._chat.ChatAPI.ask so param[3] can be customized.
Keep in sync with notebooklm-py upgrades.
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from typing import Any
from urllib.parse import quote, urlencode

import httpx

from notebooklm._chat import ChatAPI
from notebooklm.exceptions import ChatError, NetworkError
from notebooklm.rpc import QUERY_URL
from notebooklm.types import AskResult

logger = logging.getLogger(__name__)

_DEFAULT_BL = "boq_labs-tailwind-frontend_20260301.03_p0"


async def notebooklm_chat_ask_with_options(
    chat_api: ChatAPI,
    notebook_id: str,
    question: str,
    *,
    source_ids: list[str] | None,
    conversation_id: str | None,
    model_options: list[Any],
) -> AskResult:
    """Same as ChatAPI.ask but ``model_options`` replaces the default fourth param."""
    self = chat_api
    logger.debug(
        "Asking question in notebook %s (conversation=%s) model_options=%s",
        notebook_id,
        conversation_id or "new",
        model_options,
    )
    if source_ids is None:
        source_ids = await self._core.get_source_ids(notebook_id)

    is_new_conversation = conversation_id is None
    if is_new_conversation:
        conversation_id = str(uuid.uuid4())
        conversation_history = None
    else:
        assert conversation_id is not None
        conversation_history = self._build_conversation_history(conversation_id)

    sources_array = [[[sid]] for sid in source_ids] if source_ids else []

    params: list[Any] = [
        sources_array,
        question,
        conversation_history,
        model_options,
        conversation_id,
        None,
        None,
        notebook_id,
        1,
    ]

    params_json = json.dumps(params, separators=(",", ":"))
    f_req = [None, params_json]
    f_req_json = json.dumps(f_req, separators=(",", ":"))

    encoded_req = quote(f_req_json, safe="")

    body_parts = [f"f.req={encoded_req}"]
    if self._core.auth.csrf_token:
        encoded_at = quote(self._core.auth.csrf_token, safe="")
        body_parts.append(f"at={encoded_at}")

    body = "&".join(body_parts) + "&"

    self._core._reqid_counter += 100000
    url_params = {
        "bl": os.environ.get("NOTEBOOKLM_BL", _DEFAULT_BL),
        "hl": "en",
        "_reqid": str(self._core._reqid_counter),
        "rt": "c",
    }
    if self._core.auth.session_id:
        url_params["f.sid"] = self._core.auth.session_id

    query_string = urlencode(url_params)
    url = f"{QUERY_URL}?{query_string}"

    http_client = self._core.get_http_client()
    try:
        response = await http_client.post(url, content=body)
        response.raise_for_status()
    except httpx.TimeoutException as e:
        raise NetworkError(
            f"Chat request timed out: {e}",
            original_error=e,
        ) from e
    except httpx.HTTPStatusError as e:
        raise ChatError(f"Chat request failed with HTTP {e.response.status_code}: {e}") from e
    except httpx.RequestError as e:
        raise NetworkError(
            f"Chat request failed: {e}",
            original_error=e,
        ) from e

    answer_text, references, server_conv_id = self._parse_ask_response_with_references(
        response.text
    )
    if server_conv_id:
        conversation_id = server_conv_id

    turns = self._core.get_cached_conversation(conversation_id)
    if answer_text:
        turn_number = len(turns) + 1
        self._core.cache_conversation_turn(conversation_id, question, answer_text, turn_number)
    else:
        turn_number = len(turns)

    return AskResult(
        answer=answer_text,
        conversation_id=conversation_id,
        turn_number=turn_number,
        is_follow_up=not is_new_conversation,
        references=references,
        raw_response=response.text[:1000],
    )
