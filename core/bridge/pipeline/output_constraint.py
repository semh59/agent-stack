import structlog
from typing import Any

logger = structlog.get_logger(__name__)

class OutputConstraintLayer:
    """
    Injects dynamic constraints into the system prompt to enforce token efficiency.
    Ensures LLM output is lean and focused on the identified intent.
    """
    def __init__(self) -> None:
        pass

    def apply(self, message_type: str, current_prompt: str) -> str:
        """
        Appends specific constraints based on the message classification.
        """
        constraints = []

        if message_type == "code_generation":
            constraints.append("OUTPUT FORMAT: Provide ONLY the code block. Minimal prose. No explanations unless critical.")
        elif message_type == "cli_command":
            constraints.append("OUTPUT FORMAT: Provide the raw command string only. Use markdown if multiple lines.")
        elif message_type == "data_analysis":
            constraints.append("OUTPUT FORMAT: Bulleted summary first, then raw data if requested. Max 300 words.")
        else:
            constraints.append("OUTPUT FORMAT: Be concise. Avoid conversational filler.")

        if constraints:
            constraint_text = "\n\n### OUTPUT CONSTRAINTS (2026-SOTA HARDENING)\n- " + "\n- ".join(constraints)
            return current_prompt + constraint_text

        return current_prompt
