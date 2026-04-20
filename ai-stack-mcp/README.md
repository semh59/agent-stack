# Sovereign AI — MCP Orchestration Layer

This directory contains the Python-based Model Context Protocol (MCP) orchestration layer for the Sovereign AI platform.

## Architecture
- **Bridge**: Fastify-to-Python HTTP bridge for high-concurrency tool execution.
- **Pipeline**: 13-stage deterministic execution model with recursive backtracking.
- **RAG**: Vector-based semantic search and document retrieval.
- **MAB**: Multi-Armed Bandit model router for cost/performance optimization.

## Requirements
- Python 3.10+
- `pip install -r requirements.txt`
- `spacy` model: `en_core_web_sm`

## Bootstrap
Before starting the server, initialize the environment:
```bash
python scripts/bootstrap.py
```
This will download the required spaCy models and verify the environment.

## Execution
```bash
python server.py
```

## Testing
```bash
pytest tests/
```
