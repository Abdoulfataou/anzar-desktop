"""Async DeepSeek API client with streaming support and tool calling."""
import json
import logging
from typing import AsyncGenerator, Callable, Optional
import httpx
from tenacity import retry, stop_after_attempt, wait_exponential
from config import settings

logger = logging.getLogger(__name__)


class DeepSeekClient:
    """Async HTTP client for DeepSeek API."""
    
    def __init__(self):
        self.api_key = settings.deepseek_api_key
        base = (settings.deepseek_base_url or "").rstrip("/")
        # DeepSeek est compatible OpenAI: /v1/chat/completions
        self.base_url = base if base.endswith("/v1") else f"{base}/v1"
        self.timeout = httpx.Timeout(120.0, connect=15.0)
    
    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    async def stream_chat(
        self,
        messages: list[dict],
        model: str = None,
        temperature: float = 0.7,
        max_tokens: int = 4096,
    ) -> AsyncGenerator[str, None]:
        """Stream chat completion tokens from DeepSeek.

        Args:
            messages: List of message dicts with 'role' and 'content'.
            model: Model to use (defaults to chat_model).
            temperature: Generation temperature (0-2).
            max_tokens: Maximum tokens in response.

        Yields:
            Tokens as they arrive from the API.
        """
        model = model or settings.chat_model

        payload = {
            "model": model,
            "messages": messages,
            "stream": True,
            "temperature": min(max(temperature, 0), 2),
            "max_tokens": min(max_tokens, 16384),
        }
        
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            async with client.stream(
                "POST",
                f"{self.base_url}/chat/completions",
                json=payload,
                headers=headers,
            ) as response:
                if response.status_code != 200:
                    error_body = await response.aread()
                    raise Exception(f"API error {response.status_code}: {error_body.decode()}")
                
                async for line in response.aiter_lines():
                    if not line or line.startswith(":"):
                        continue
                    
                    if line.startswith("data: "):
                        line = line[6:]
                    
                    if line == "[DONE]":
                        break
                    
                    try:
                        data = json.loads(line)
                        if "choices" in data and len(data["choices"]) > 0:
                            delta = data["choices"][0].get("delta", {})
                            if "content" in delta:
                                yield delta["content"]
                    except json.JSONDecodeError:
                        pass
    
    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    async def chat(
        self,
        messages: list[dict],
        model: str = None,
        temperature: float = 0.7,
        max_tokens: int = 4096,
    ) -> str:
        """Get complete chat response from DeepSeek.

        Args:
            messages: List of message dicts with 'role' and 'content'.
            model: Model to use (defaults to chat_model).
            temperature: Generation temperature.
            max_tokens: Maximum tokens in response.

        Returns:
            Complete response text.
        """
        result = ""
        async for token in self.stream_chat(messages, model, temperature, max_tokens):
            result += token
        return result
    
    async def chat_with_reasoning(
        self,
        messages: list[dict],
        model: str = None,
    ) -> tuple[str, str]:
        """Get chat response with reasoning from deepseek-reasoner.
        
        Args:
            messages: List of message dicts with 'role' and 'content'.
            model: Model to use (defaults to reasoner_model).
            
        Returns:
            Tuple of (reasoning_content, response_content).
        """
        model = model or settings.reasoner_model
        
        payload = {
            "model": model,
            "messages": messages,
        }
        
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(
                f"{self.base_url}/chat/completions",
                json=payload,
                headers=headers,
            )
            
            if response.status_code != 200:
                raise Exception(f"API error {response.status_code}: {response.text}")
            
            data = response.json()
            reasoning = ""
            content = ""
            
            if "choices" in data and len(data["choices"]) > 0:
                choice = data["choices"][0]
                if "message" in choice:
                    message = choice["message"]
                    reasoning = message.get("reasoning_content", "")
                    content = message.get("content", "")
            
            return reasoning, content

    async def chat_with_tools(
        self,
        messages: list[dict],
        tools: list[dict],
        tool_executor: Callable,
        model: str = None,
        temperature: float = 0.7,
        max_tokens: int = 4096,
        max_tool_rounds: int = 3,
    ) -> str:
        """
        Chat with automatic tool calling loop.

        DeepSeek may request tool calls (e.g. web_search). This method:
        1. Sends the request with tools defined.
        2. If DeepSeek returns tool_calls, executes them via tool_executor.
        3. Feeds tool results back and repeats (up to max_tool_rounds).
        4. Returns the final text response.

        Args:
            messages: Conversation messages.
            tools: List of tool definitions (OpenAI format).
            tool_executor: async fn(name, args) -> str that runs the tool.
            model: Model to use.
            temperature: Generation temperature.
            max_tokens: Max output tokens.
            max_tool_rounds: Max number of tool call rounds.

        Returns:
            Final text response from DeepSeek.
        """
        model = model or settings.chat_model
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        conversation = list(messages)

        for round_idx in range(max_tool_rounds + 1):
            payload = {
                "model": model,
                "messages": conversation,
                "temperature": min(max(temperature, 0), 2),
                "max_tokens": min(max_tokens, 16384),
                "tools": tools,
                "tool_choice": "auto",
            }

            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    f"{self.base_url}/chat/completions",
                    json=payload,
                    headers=headers,
                )

            if response.status_code != 200:
                raise Exception(f"API error {response.status_code}: {response.text[:500]}")

            data = response.json()
            choice = data.get("choices", [{}])[0]
            message = choice.get("message", {})
            finish_reason = choice.get("finish_reason", "")

            # If model wants to call tools
            tool_calls = message.get("tool_calls")
            if tool_calls and finish_reason == "tool_calls":
                # Append the assistant message with tool_calls
                conversation.append(message)

                # Execute each tool call
                for tc in tool_calls:
                    fn_name = tc["function"]["name"]
                    try:
                        fn_args = json.loads(tc["function"]["arguments"])
                    except json.JSONDecodeError:
                        fn_args = {}

                    logger.info(f"Tool call [{round_idx+1}]: {fn_name}({fn_args})")

                    try:
                        result = await tool_executor(fn_name, fn_args)
                    except Exception as e:
                        result = json.dumps({"error": str(e)})

                    # Append tool result
                    conversation.append({
                        "role": "tool",
                        "tool_call_id": tc["id"],
                        "content": result if isinstance(result, str) else json.dumps(result),
                    })

                # Continue loop — DeepSeek will process tool results
                continue

            # No tool calls — return the final text
            return message.get("content", "")

        # Exhausted rounds — return whatever we have
        logger.warning(f"Tool calling exhausted {max_tool_rounds} rounds")
        return message.get("content", "")


# Global client instance
deepseek_client = DeepSeekClient()
