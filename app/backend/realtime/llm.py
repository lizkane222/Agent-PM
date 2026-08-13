"""
Bedrock LLM integration for ConversationRelay voice sessions.

Provides an async generator that streams Claude responses token-by-token
so Twilio's TTS can begin speaking before the full response is ready.
"""

import os
from typing import AsyncGenerator

from anthropic import AsyncAnthropicBedrock

_SYSTEM_PROMPT = (
    "You are Agent PM, a helpful AI assistant for product managers at Twilio. "
    "You are speaking with a user on a live phone call. "
    "Keep your responses concise and conversational — typically one to three sentences. "
    "Do not use markdown, bullet points, headers, or lists; they will not render in voice. "
    "Answer questions directly and clearly."
)

_DEFAULT_MODEL = "anthropic.claude-3-5-haiku-20241022:0"


async def bedrock_stream(
    utterance: str,
    history: list[dict],
) -> AsyncGenerator[str, None]:
    """
    Stream a Claude Bedrock response for a voice prompt.

    Yields raw text chunks as they arrive from the model so the caller can
    forward them to Twilio ConversationRelay with minimal latency.

    Args:
        utterance: The transcribed caller speech for this turn.
        history:   Previous turns as [{"role": "user"|"assistant", "content": "..."}].
    """
    aws_region = os.environ.get("AWS_REGION", "us-east-1")
    model_id = os.environ.get("VOICE_BEDROCK_MODEL_ID", _DEFAULT_MODEL)

    messages = list(history) + [{"role": "user", "content": utterance}]

    client = AsyncAnthropicBedrock(aws_region=aws_region)
    async with client.messages.stream(
        model=model_id,
        max_tokens=512,
        system=_SYSTEM_PROMPT,
        messages=messages,
    ) as stream:
        async for chunk in stream.text_stream:
            yield chunk
