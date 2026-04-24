"""Async DeepSeek API client with streaming support."""
import json
from typing import AsyncGenerator, Optional
import httpx
from tenacity import retry, stop_after_attempt, wait_exponential
from config import settings


class DeepSeekClient:
    """Async HTTP client for DeepSeek API."""
    
    def __init__(self):
        self.api_key = settings.deepseek_api_key
        self.base_url = settings.deepseek_base_url
        self.timeout = httpx.Timeout(60.0, connect=10.0)
    
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


# Global client instance
deepseek_client = DeepSeekClient()
