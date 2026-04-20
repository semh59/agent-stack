# Contributing to Sovereign Sovereign Factory

Welcome to the Sovereign elite orchestration layer. This document outlines the standards and patterns for contributing to this system.

## Architectural Principles

We follow a strict **Layered Chain** with a Unit of Work (UoW) requirement:
`router → service → unit_of_work → repository → model`

### Orchestration Layer

The core of the system is the **SequentialPipeline**. It manages 18 specialized agents.

- **Prompts**: All agent system prompts must be externalized in `src/orchestration/prompts.yaml`. Do not hardcode prompts in the `AgentDefinition`.
- **Validation**: Every agent that produces structured data must have a corresponding Zod schema in `src/orchestration/schemas.ts`.
- **RARV Loop**: Tools are executed via the Read-Analyze-Run-Verify (RARV) loop. Ensure all new tools are compatible with the `IToolExecutionEngine` interface.

## Technical Standards

- **Type Safety**: All public functions MUST have complete type hints and TSDoc/JSDoc comments.
- **Security**:
  - Never log PII (TCKN, Phone, Names) in audit logs.
  - All token storage must use the `KeyManager` with AES-256-GCM encryption.
  - Shell commands must be sanitized and executed via `spawn` with argument arrays, never raw strings.
- **UI/UX**:
  - Use `Skeleton` components for any async operations in the React app.
  - Ensure all interactive elements have appropriate ARIA labels.
  - Maintain theme persistence through the `appStore` Zustand persist middleware.

## Workflow

1. **Research**: Check existing Knowledge Items (KIs) before starting new architectural changes.
2. **Plan**: Create an `implementation_plan.md` for major refactors.
3. **Verify**: All changes must pass the internal regression suite (`npm run test`).
4. **Document**: Update the `walkthrough.md` for the current phase.

---

_Sovereign — Elite Global Agent Standards enforced._
