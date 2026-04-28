from __future__ import annotations

import ast
import asyncio
import time
from typing import Any

import aiohttp
import structlog  # type: ignore

from config import Settings  # type: ignore

logger = structlog.get_logger(__name__)


class SpeculativeConsensusRouter:
    """
    Speculative Execution Engine for the Alloy Bridge.

    Instead of sequentially querying one large LLM, this router simultaneously
    dispatches requests to multiple models (e.g., small local Llama 3 vs. large Claude Opus).
    It intercepts the streams as they finish:
      - If it's code generation, it strictly enforces AST (Abstract Syntax Tree) validity.
      - If a small model returns structurally valid code faster, it instantly returns
        the result and cancels the lingering large model tasks to save tokens/API costs.
    """

    def __init__(self, settings: Settings):
        self.settings = settings
        # The primary proxy endpoint (Gateway or direct OpenAI-compatible endpoint)
        self.completion_endpoint = "http://127.0.0.1:3000/api/internal/chat"
        self._session: aiohttp.ClientSession | None = None

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession()
        return self._session

    async def close(self) -> None:
        if self._session and not self._session.closed:
            await self._session.close()

    def validate_ast(self, code_string: str) -> bool:
        """
        Extracts python code blocks from the LLM response and runs an AST parse
        to verify structural integrity (no SyntaxErrors, missing colons, etc.).
        """
        # Extremely barebone extractor (in real production, use tree_sitter or regex matching strictly)
        import re

        code_blocks = re.findall(r"```(?:python|py)\n(.*?)```", code_string, re.DOTALL)

        # If no code block found, but intent was code_generation, it's considered a fail
        # Or you might just parse the whole response if it's pure code
        text_to_validate = "\n".join(code_blocks) if code_blocks else code_string

        try:
            ast.parse(text_to_validate)
            return True
        except SyntaxError:
            return False
        except Exception:
            return False

    async def _dispatch_single_model(
        self, model_id: str, context: str, intent: str, delay_mock: float = 0.0
    ) -> tuple[str, str, float]:
        """
        Dispatches the HTTP request to the LLM.
        Note: Currently includes a testing 'delay_mock' to simulate inference latency differences.
        Returns: (model_id, response_text, elapsed_ms)
        """
        start = time.monotonic()

        # Testing loop simulation (If we are running benchmarks, we mock the network HTTP latency)
        if delay_mock > 0:
            await asyncio.sleep(delay_mock)
            elapsed = (time.monotonic() - start) * 1000
            if "fail_syntax" in model_id:
                return (model_id, "def broken_function() \n    return 5", elapsed)
            else:
                return (model_id, "def perfect_function():\n    return 5", elapsed)

        session = await self._get_session()
        payload = {
            "model": model_id,
            "messages": [{"role": "user", "content": context}],
            "intent": intent,
        }

        try:
            # We enforce a timeout for safety
            async with session.post(
                self.completion_endpoint, json=payload, timeout=aiohttp.ClientTimeout(total=30.0)
            ) as resp:  # type: ignore
                # In actual production, this would stream and parse AST on the fly.
                # For Phase 8 architecture, we wait for full completion.
                data = await resp.json()
                elapsed = (time.monotonic() - start) * 1000
                return (model_id, data.get("response", ""), elapsed)
        except Exception as e:
            logger.warning("speculative_dispatch_failed", model=model_id, error=str(e))
            elapsed = (time.monotonic() - start) * 1000
            return (model_id, f"ERROR: {str(e)}", elapsed)

    async def execute_parallel(
        self, context: str, intent: str, models: list[dict[str, Any]]
    ) -> dict[str, Any]:
        """
        Executes multiple models concurrently.
        Validates structurally upon FIRST_COMPLETED. If the fastest model generates
        garbage/invalid Python AST, the router intercepts it, suppresses it, and waits
        for the next model in the queue to finish.

        `models` should be a list of dicts like:
        [{"id": "ollama/llama3-8b", "mock_delay": 0.3}, {"id": "claude-3-opus", "mock_delay": 2.0}]
        """
        tasks = []
        for m in models:
            task = asyncio.create_task(
                self._dispatch_single_model(
                    m["id"], context, intent, delay_mock=m.get("mock_delay", 0.0)
                )
            )
            tasks.append(task)

        pending = set(tasks)

        while pending:
            # Wait for any of the tasks to finish
            done, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)

            for completed_task in done:
                try:
                    model_id, response_text, elapsed_ms = completed_task.result()

                    if "ERROR:" in response_text:
                        logger.debug("speculative_model_errored", model=model_id)
                        continue

                    # AST CONSENSUS PROTOCOL
                    if intent == "code_generation":
                        is_valid = self.validate_ast(response_text)
                        if not is_valid:
                            logger.info(
                                "speculative_ast_rejected",
                                model=model_id,
                                elapsed=round(elapsed_ms, 2),
                            )
                            # Reject this stream, the while loop will naturally wait for the next model
                            continue

                    # If we reach here, the model is both fast AND accurate
                    logger.info(
                        "speculative_consensus_winner",
                        winner=model_id,
                        elapsed=round(elapsed_ms, 2),
                        cancelled_losers=len(pending),
                    )

                    # CANCELLATION TOKEN: Kill the lingering heavy models securely
                    for p in pending:
                        p.cancel()

                    return {
                        "winner_model": model_id,
                        "response": response_text,
                        "latency_ms": elapsed_ms,
                        "cancelled_tasks": len(pending),
                    }

                except Exception as e:
                    logger.error("speculative_task_exception", error=str(e))

        # If all models failed or crashed
        return {
            "winner_model": "None",
            "response": "All speculative consensus workers failed.",
            "latency_ms": 0.0,
            "cancelled_tasks": 0,
        }
