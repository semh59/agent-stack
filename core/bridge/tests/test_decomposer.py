"""Tests for pipeline/decomposer.py"""
import json
import pytest
from unittest.mock import AsyncMock

from pipeline.decomposer import Decomposer, DecomposedPlan, AgentTask
from pipeline.spec_generator import ProjectSpec


def _make_spec(name: str = "Test Project", description: str = "A test project") -> ProjectSpec:
    return ProjectSpec(
        name=name,
        description=description,
        features=[{"name": "auth", "priority": "high", "description": "Authentication"}],
        tech_stack={"backend": "Python", "frontend": "React", "database": "PostgreSQL"},
        file_structure=["src/", "src/api/"],
        phases=[{"phase": "MVP", "features": ["auth"]}],
    )


def _mock_router(content: str) -> AsyncMock:
    router = AsyncMock()
    router.route_call.return_value = {
        "choices": [{"message": {"content": content}}]
    }
    return router


@pytest.mark.asyncio
async def test_decompose_basic():
    tasks_payload = {
        "tasks": [
            {
                "id": "T1",
                "role": "ARCHITECT",
                "title": "System Design",
                "description": "Design overall architecture",
                "depends_on": [],
                "acceptance_criteria": ["Architecture diagram created"],
                "estimated_minutes": 30,
            },
            {
                "id": "T2",
                "role": "BACKEND_DEV",
                "title": "Implement API",
                "description": "Build REST API endpoints",
                "depends_on": ["T1"],
                "acceptance_criteria": ["All endpoints return 200", "Tests pass"],
                "estimated_minutes": 60,
            },
        ]
    }
    agent = Decomposer(_mock_router(json.dumps(tasks_payload)))
    plan = await agent.decompose(_make_spec())

    assert plan.project_name == "Test Project"
    assert len(plan.tasks) == 2
    assert plan.tasks[0].id == "T1"
    assert plan.tasks[0].role == "ARCHITECT"
    assert plan.tasks[1].depends_on == ["T1"]
    assert plan.tasks[0].estimated_minutes == 30


@pytest.mark.asyncio
async def test_decompose_acceptance_criteria():
    tasks_payload = {
        "tasks": [
            {
                "id": "T1",
                "role": "QA",
                "title": "Write Tests",
                "description": "Unit and integration tests",
                "depends_on": [],
                "acceptance_criteria": ["Coverage > 80%", "All tests green"],
                "estimated_minutes": 45,
            }
        ]
    }
    agent = Decomposer(_mock_router(json.dumps(tasks_payload)))
    plan = await agent.decompose(_make_spec())

    assert "Coverage > 80%" in plan.tasks[0].acceptance_criteria
    assert "All tests green" in plan.tasks[0].acceptance_criteria


@pytest.mark.asyncio
async def test_decompose_fallback_on_bad_json():
    """Router returns garbage JSON â†’ single fallback task."""
    agent = Decomposer(_mock_router("not json at all"))
    plan = await agent.decompose(_make_spec("FallbackApp", "fallback description"))

    assert plan.project_name == "FallbackApp"
    assert len(plan.tasks) == 1
    assert plan.tasks[0].id == "T1"
    assert plan.tasks[0].role == "DEVELOPER"
    assert plan.tasks[0].title == "FallbackApp"
    assert plan.tasks[0].description == "fallback description"


@pytest.mark.asyncio
async def test_decompose_fallback_on_router_error():
    """Router raises exception â†’ single fallback task."""
    router = AsyncMock()
    router.route_call.side_effect = RuntimeError("network error")
    agent = Decomposer(router)
    plan = await agent.decompose(_make_spec("ErrorApp"))

    assert plan.project_name == "ErrorApp"
    assert len(plan.tasks) == 1
    assert plan.tasks[0].role == "DEVELOPER"


@pytest.mark.asyncio
async def test_decompose_extracts_json_from_prose():
    """Router wraps JSON in prose text â†’ parser still extracts it."""
    tasks_payload = {"tasks": [{"id": "T1", "role": "DEVELOPER", "title": "Build",
                                "description": "Build the thing", "depends_on": [],
                                "acceptance_criteria": [], "estimated_minutes": 20}]}
    wrapped = f"Here is the decomposition:\n```json\n{json.dumps(tasks_payload)}\n```\nDone."
    agent = Decomposer(_mock_router(wrapped))
    plan = await agent.decompose(_make_spec())

    assert len(plan.tasks) == 1
    assert plan.tasks[0].title == "Build"


@pytest.mark.asyncio
async def test_decompose_defaults_missing_fields():
    """Tasks with missing optional fields get sensible defaults."""
    tasks_payload = {"tasks": [{"title": "Minimal Task", "description": "Do stuff"}]}
    agent = Decomposer(_mock_router(json.dumps(tasks_payload)))
    plan = await agent.decompose(_make_spec())

    task = plan.tasks[0]
    assert task.id == "T1"           # auto-generated
    assert task.role == "DEVELOPER"  # default
    assert task.depends_on == []
    assert task.acceptance_criteria == []
    assert task.estimated_minutes == 15


def test_to_gateway_payload_structure():
    plan = DecomposedPlan(
        project_name="MyProject",
        tasks=[
            AgentTask(
                id="T1",
                role="ARCHITECT",
                title="Design",
                description="Design the system",
                depends_on=[],
                acceptance_criteria=["Diagram exists"],
                estimated_minutes=20,
            ),
            AgentTask(
                id="T2",
                role="BACKEND_DEV",
                title="Implement",
                description="Code it up",
                depends_on=["T1"],
                acceptance_criteria=["Tests pass"],
                estimated_minutes=45,
            ),
        ],
    )
    payload = plan.to_gateway_payload()

    assert payload["projectName"] == "MyProject"
    assert len(payload["agents"]) == 2

    a0 = payload["agents"][0]
    assert a0["role"] == "ARCHITECT"
    assert a0["title"] == "Design"
    assert a0["dependsOn"] == []
    assert a0["acceptanceCriteria"] == ["Diagram exists"]
    assert a0["estimatedMinutes"] == 20

    a1 = payload["agents"][1]
    assert a1["dependsOn"] == ["T1"]


def test_agent_task_defaults():
    task = AgentTask(id="T1", role="QA", title="Test", description="Run tests")
    assert task.depends_on == []
    assert task.acceptance_criteria == []
    assert task.estimated_minutes == 15


def test_decomposed_plan_empty_tasks():
    plan = DecomposedPlan(project_name="Empty", tasks=[])
    payload = plan.to_gateway_payload()
    assert payload["projectName"] == "Empty"
    assert payload["agents"] == []
