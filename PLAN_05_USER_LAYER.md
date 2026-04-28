# Plan 05 — Kullanıcı Katmanı: %0 → %100

## Mevcut Durum
Hiç başlanmadı. Bu Alloy'un asıl rekabet avantajı:
kod bilmeyen kullanıcı için "yazılım şirketi gibi" çalışan sistem.
Bridge ve Console tamamlandıktan sonra bu katman gelir.

## Mimari Akış
```
Kullanıcı prompt girer
      ↓
[DiscoveryAgent] — ne yapmak istiyor? belirsizlikleri sora
      ↓
[SpecGenerator]  — teknik spec üretir (özellikler, kısıtlar)
      ↓
[Decomposer]     — spec'i atomik task'lara böler
      ↓
[Gateway SequentialPipeline] — her task'ı çalıştırır
      ↓
[CheckpointManager] — her adımda durum kaydeder
      ↓
Console'da adım adım ilerleme gösterilir, onay alınır
```

## Kabul Kriterleri
```bash
# Bridge testleri (yeni modüller için):
cd core/bridge
pytest tests/test_discovery.py -x
pytest tests/test_decomposer.py -x

# Gateway entegrasyon testi:
cd core/gateway
npm test -- --grep "UserLayer"
```

---

## Görev 1 — `core/bridge/pipeline/discovery_agent.py`

**Oluştur:** `core/bridge/pipeline/discovery_agent.py`

```python
"""
DiscoveryAgent — kullanıcının amacını anlar, eksik bilgileri sorar.

Akış:
1. Kullanıcı prompt alınır
2. Belirsizlikler tespit edilir (hedef kitle, teknoloji, kısıtlar)
3. Netleştirme soruları üretilir
4. Yanıtlarla birlikte tam bir bağlam oluşturulur
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

import structlog

logger = structlog.get_logger(__name__)


@dataclass
class DiscoveryContext:
    """Kullanıcının niyetine dair toplanmış bilgiler."""
    raw_prompt: str
    clarified_goal: str = ""
    target_audience: str = ""
    tech_constraints: list[str] = field(default_factory=list)
    must_have: list[str] = field(default_factory=list)
    nice_to_have: list[str] = field(default_factory=list)
    clarification_rounds: int = 0

    def is_complete(self) -> bool:
        """Yeterli bilgi toplandı mı?"""
        return bool(
            self.clarified_goal
            and (self.must_have or self.clarification_rounds >= 2)
        )

    def to_spec_prompt(self) -> str:
        """SpecGenerator'a verilecek bağlam metnini oluşturur."""
        parts = [f"Hedef: {self.clarified_goal}"]
        if self.target_audience:
            parts.append(f"Hedef kitle: {self.target_audience}")
        if self.tech_constraints:
            parts.append(f"Teknoloji kısıtları: {', '.join(self.tech_constraints)}")
        if self.must_have:
            parts.append(f"Olmazsa olmaz: {', '.join(self.must_have)}")
        if self.nice_to_have:
            parts.append(f"İyi olur: {', '.join(self.nice_to_have)}")
        return "\n".join(parts)


class DiscoveryAgent:
    """
    Kullanıcı amacını netleştirir.
    LLM çağrısı için provider_router kullanır.
    """

    SYSTEM_PROMPT = (
        "Sen bir yazılım danışmanısın. Kullanıcının ne yapmak istediğini "
        "anlamak için kısa, net sorular sor. Teknik jargondan kaçın. "
        "Maksimum 3 soru sor, her biri tek cümle."
    )

    def __init__(self, provider_router: Any) -> None:
        self.provider_router = provider_router

    async def discover(self, prompt: str) -> DiscoveryContext:
        """
        Tek turda discovery yapar.
        Dönen context.is_complete() False ise daha fazla tur gerekir.
        """
        ctx = DiscoveryContext(raw_prompt=prompt)

        analysis_prompt = (
            f"Kullanıcı şunu söyledi: '{prompt}'\n\n"
            "JSON formatında yanıtla:\n"
            "{\n"
            '  "clarified_goal": "...",\n'
            '  "target_audience": "...",\n'
            '  "tech_constraints": [],\n'
            '  "must_have": [],\n'
            '  "nice_to_have": [],\n'
            '  "clarification_questions": []\n'
            "}"
        )

        try:
            response = await self.provider_router.route_call(
                model="tier0-prose",
                messages=[
                    {"role": "system", "content": self.SYSTEM_PROMPT},
                    {"role": "user", "content": analysis_prompt},
                ],
                temperature=0.3,
                max_tokens=800,
            )
            raw = response["choices"][0]["message"]["content"]
            # JSON bloğunu çıkar
            start = raw.find("{")
            end = raw.rfind("}") + 1
            if start >= 0 and end > start:
                data = json.loads(raw[start:end])
                ctx.clarified_goal   = data.get("clarified_goal", "")
                ctx.target_audience  = data.get("target_audience", "")
                ctx.tech_constraints = data.get("tech_constraints", [])
                ctx.must_have        = data.get("must_have", [])
                ctx.nice_to_have     = data.get("nice_to_have", [])
        except Exception as exc:
            logger.warning("discovery_failed", error=str(exc))
            ctx.clarified_goal = prompt  # fallback

        ctx.clarification_rounds += 1
        return ctx
```

---

## Görev 2 — `core/bridge/pipeline/spec_generator.py`

**Oluştur:** `core/bridge/pipeline/spec_generator.py`

```python
"""
SpecGenerator — DiscoveryContext'ten teknik spec üretir.

Spec içeriği:
- Proje adı + kısa açıklama
- Özellik listesi (gruplandırılmış)
- Teknik yığın önerisi
- Beklenen dosya/klasör yapısı
- Aşama planı (MVP → V1 → V2)
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

import structlog

from pipeline.discovery_agent import DiscoveryContext

logger = structlog.get_logger(__name__)


@dataclass
class ProjectSpec:
    name: str
    description: str
    features: list[dict[str, Any]] = field(default_factory=list)
    tech_stack: dict[str, str] = field(default_factory=dict)
    file_structure: list[str] = field(default_factory=list)
    phases: list[dict[str, Any]] = field(default_factory=list)

    def to_decomposer_prompt(self) -> str:
        """Decomposer'a verilecek bağlam."""
        return json.dumps({
            "name": self.name,
            "description": self.description,
            "features": self.features,
            "tech_stack": self.tech_stack,
            "phases": self.phases,
        }, ensure_ascii=False, indent=2)


class SpecGenerator:
    SYSTEM_PROMPT = (
        "Sen kıdemli bir yazılım mimarısın. "
        "Verilen hedefe göre detaylı bir teknik spec üret. "
        "JSON formatında yanıtla."
    )

    def __init__(self, provider_router: Any) -> None:
        self.provider_router = provider_router

    async def generate(self, ctx: DiscoveryContext) -> ProjectSpec:
        spec_prompt = (
            f"Aşağıdaki projeyi detaylandır:\n{ctx.to_spec_prompt()}\n\n"
            "JSON formatında yanıtla:\n"
            "{\n"
            '  "name": "...",\n'
            '  "description": "...",\n'
            '  "features": [{"name": "...", "priority": "high|medium|low", "description": "..."}],\n'
            '  "tech_stack": {"backend": "...", "frontend": "...", "database": "..."},\n'
            '  "file_structure": ["src/", "src/api/", "..."],\n'
            '  "phases": [{"phase": "MVP", "features": ["..."]}]\n'
            "}"
        )

        try:
            response = await self.provider_router.route_call(
                model="tier0-prose",
                messages=[
                    {"role": "system", "content": self.SYSTEM_PROMPT},
                    {"role": "user", "content": spec_prompt},
                ],
                temperature=0.2,
                max_tokens=2000,
            )
            raw = response["choices"][0]["message"]["content"]
            start = raw.find("{")
            end = raw.rfind("}") + 1
            if start >= 0 and end > start:
                data = json.loads(raw[start:end])
                return ProjectSpec(
                    name=data.get("name", ctx.clarified_goal[:50]),
                    description=data.get("description", ""),
                    features=data.get("features", []),
                    tech_stack=data.get("tech_stack", {}),
                    file_structure=data.get("file_structure", []),
                    phases=data.get("phases", []),
                )
        except Exception as exc:
            logger.warning("spec_generation_failed", error=str(exc))

        # Fallback: minimal spec
        return ProjectSpec(
            name=ctx.clarified_goal[:50],
            description=ctx.clarified_goal,
            features=[{"name": f, "priority": "high", "description": f} for f in ctx.must_have],
        )
```

---

## Görev 3 — `core/bridge/pipeline/decomposer.py`

**Oluştur:** `core/bridge/pipeline/decomposer.py`

```python
"""
Decomposer — ProjectSpec'i Gateway'in anlayabileceği
atomik AgentTask listesine böler.

Her task:
- Bağımsız çalışabilir (bağımlılıklar açık)
- Tek bir agent tarafından yürütülür
- Kendi kabul kriteri var
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

import structlog

from pipeline.spec_generator import ProjectSpec

logger = structlog.get_logger(__name__)


@dataclass
class AgentTask:
    id: str
    role: str          # ARCHITECT, BACKEND_DEV, FRONTEND_DEV, QA vb.
    title: str
    description: str
    depends_on: list[str] = field(default_factory=list)
    acceptance_criteria: list[str] = field(default_factory=list)
    estimated_minutes: int = 15


@dataclass
class DecomposedPlan:
    project_name: str
    tasks: list[AgentTask]

    def to_gateway_payload(self) -> dict[str, Any]:
        """Gateway'in mission başlatma endpoint'ine gönderilecek payload."""
        return {
            "projectName": self.project_name,
            "agents": [
                {
                    "role": t.role,
                    "title": t.title,
                    "description": t.description,
                    "dependsOn": t.depends_on,
                    "acceptanceCriteria": t.acceptance_criteria,
                    "estimatedMinutes": t.estimated_minutes,
                }
                for t in self.tasks
            ],
        }


class Decomposer:
    SYSTEM_PROMPT = (
        "Sen bir proje yöneticisisin. "
        "Verilen spec'i paralel ve sıralı çalışabilecek "
        "atomik görevlere böl. Her görev tek bir developer "
        "tarafından tamamlanabilir olmalı."
    )

    def __init__(self, provider_router: Any) -> None:
        self.provider_router = provider_router

    async def decompose(self, spec: ProjectSpec) -> DecomposedPlan:
        decompose_prompt = (
            f"Şu projeyi görevlere böl:\n{spec.to_decomposer_prompt()}\n\n"
            "JSON formatında yanıtla:\n"
            '{"tasks": [{"id": "T1", "role": "ARCHITECT", "title": "...", '
            '"description": "...", "depends_on": [], '
            '"acceptance_criteria": ["..."], "estimated_minutes": 15}]}'
        )

        try:
            response = await self.provider_router.route_call(
                model="tier0-prose",
                messages=[
                    {"role": "system", "content": self.SYSTEM_PROMPT},
                    {"role": "user", "content": decompose_prompt},
                ],
                temperature=0.1,
                max_tokens=3000,
            )
            raw = response["choices"][0]["message"]["content"]
            start = raw.find("{")
            end = raw.rfind("}") + 1
            if start >= 0 and end > start:
                data = json.loads(raw[start:end])
                tasks = [
                    AgentTask(
                        id=t.get("id", f"T{i+1}"),
                        role=t.get("role", "DEVELOPER"),
                        title=t.get("title", ""),
                        description=t.get("description", ""),
                        depends_on=t.get("depends_on", []),
                        acceptance_criteria=t.get("acceptance_criteria", []),
                        estimated_minutes=int(t.get("estimated_minutes", 15)),
                    )
                    for i, t in enumerate(data.get("tasks", []))
                ]
                return DecomposedPlan(project_name=spec.name, tasks=tasks)
        except Exception as exc:
            logger.warning("decompose_failed", error=str(exc))

        # Fallback: tek task
        return DecomposedPlan(
            project_name=spec.name,
            tasks=[
                AgentTask(
                    id="T1",
                    role="DEVELOPER",
                    title=spec.name,
                    description=spec.description,
                )
            ],
        )
```

---

## Görev 4 — `core/bridge/pipeline/checkpoint.py`

**Oluştur:** `core/bridge/pipeline/checkpoint.py`

```python
"""
CheckpointManager — her görev adımında durum kaydeder.

Özellikler:
- Aiosqlite'a checkpoint kaydeder
- Rollback desteği (önceki adıma dön)
- Gateway SequentialPipeline ile uyumlu API
"""
from __future__ import annotations

import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import aiosqlite
import structlog

logger = structlog.get_logger(__name__)


@dataclass
class Checkpoint:
    id: str
    task_id: str
    project_name: str
    state: dict[str, Any]
    created_at: float
    status: str   # "active" | "rolled_back"


class CheckpointManager:
    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path

    async def initialize(self) -> None:
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute("""
                CREATE TABLE IF NOT EXISTS checkpoints (
                    id TEXT PRIMARY KEY,
                    task_id TEXT NOT NULL,
                    project_name TEXT NOT NULL,
                    state_json TEXT NOT NULL,
                    created_at REAL NOT NULL,
                    status TEXT NOT NULL DEFAULT 'active'
                )
            """)
            await db.commit()

    async def save(
        self,
        checkpoint_id: str,
        task_id: str,
        project_name: str,
        state: dict[str, Any],
    ) -> str:
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                "INSERT OR REPLACE INTO checkpoints VALUES (?,?,?,?,?,?)",
                (checkpoint_id, task_id, project_name,
                 json.dumps(state, ensure_ascii=False),
                 time.time(), "active"),
            )
            await db.commit()
        logger.info("checkpoint_saved", id=checkpoint_id, task=task_id)
        return checkpoint_id

    async def load(self, checkpoint_id: str) -> Checkpoint | None:
        async with aiosqlite.connect(self.db_path) as db:
            async with db.execute(
                "SELECT * FROM checkpoints WHERE id=?", (checkpoint_id,)
            ) as cur:
                row = await cur.fetchone()
                if not row:
                    return None
                return Checkpoint(
                    id=row[0],
                    task_id=row[1],
                    project_name=row[2],
                    state=json.loads(row[3]),
                    created_at=row[4],
                    status=row[5],
                )

    async def rollback(self, checkpoint_id: str) -> dict[str, Any] | None:
        """Checkpoint'e geri döner, state'i döndürür."""
        cp = await self.load(checkpoint_id)
        if not cp:
            logger.warning("checkpoint_not_found", id=checkpoint_id)
            return None

        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                "UPDATE checkpoints SET status='rolled_back' WHERE id > ?",
                (checkpoint_id,),
            )
            await db.commit()

        logger.info("checkpoint_rolled_back", id=checkpoint_id)
        return cp.state

    async def list_project_checkpoints(self, project_name: str) -> list[Checkpoint]:
        async with aiosqlite.connect(self.db_path) as db:
            async with db.execute(
                "SELECT * FROM checkpoints WHERE project_name=? AND status='active' ORDER BY created_at",
                (project_name,),
            ) as cur:
                rows = await cur.fetchall()
                return [
                    Checkpoint(id=r[0], task_id=r[1], project_name=r[2],
                               state=json.loads(r[3]), created_at=r[4], status=r[5])
                    for r in rows
                ]
```

---

## Görev 5 — MCP tool olarak sun (`server.py`'ye ekle)

**Dosya:** `core/bridge/server.py` — `list_tools()` içine ekle:

```python
mcp_types.Tool(
    name="start_project",
    description=(
        "Kullanıcının açıkladığı projeyi analiz eder, spec üretir ve "
        "Gateway'e görev planı gönderir. Tek cümlelik açıklama yeterli."
    ),
    inputSchema={
        "type": "object",
        "properties": {
            "description": {
                "type": "string",
                "description": "Ne yapmak istediğinizi açıklayın",
            },
            "gateway_url": {
                "type": "string",
                "default": "http://localhost:3000",
            },
        },
        "required": ["description"],
    },
),
```

**`handle_call()` içine handler ekle:**
```python
elif name == "start_project":
    description = str(args.get("description", ""))
    orch = await _get_orch()
    await orch.initialize()
    
    # Discovery → Spec → Decompose
    from pipeline.discovery_agent import DiscoveryAgent
    from pipeline.spec_generator import SpecGenerator
    from pipeline.decomposer import Decomposer
    
    da = DiscoveryAgent(orch.provider_router)
    sg = SpecGenerator(orch.provider_router)
    dc = Decomposer(orch.provider_router)
    
    ctx  = await da.discover(description)
    spec = await sg.generate(ctx)
    plan = await dc.decompose(spec)
    
    return [mcp_types.TextContent(
        type="text",
        text=json.dumps(plan.to_gateway_payload(), ensure_ascii=False, indent=2)
    )]
```

---

## Görev 6 — Testleri yaz

**Oluştur:** `core/bridge/tests/test_discovery.py`
**Oluştur:** `core/bridge/tests/test_decomposer.py`

Her dosya için `AsyncMock` ile provider_router'ı mock'la:

```python
# tests/test_discovery.py
import pytest
from unittest.mock import AsyncMock
from pipeline.discovery_agent import DiscoveryAgent, DiscoveryContext

@pytest.mark.asyncio
async def test_discover_basic():
    mock_router = AsyncMock()
    mock_router.route_call.return_value = {
        "choices": [{
            "message": {
                "content": '{"clarified_goal": "Todo app", "target_audience": "personal use", '
                           '"tech_constraints": [], "must_have": ["add task", "delete task"], '
                           '"nice_to_have": [], "clarification_questions": []}'
            }
        }]
    }
    agent = DiscoveryAgent(mock_router)
    ctx = await agent.discover("bir todo uygulaması yap")
    
    assert ctx.clarified_goal == "Todo app"
    assert "add task" in ctx.must_have
    assert ctx.clarification_rounds == 1
```

---

## Son Kontrol Listesi
- [ ] `core/bridge/pipeline/discovery_agent.py` mevcut, test geçiyor
- [ ] `core/bridge/pipeline/spec_generator.py` mevcut, test geçiyor
- [ ] `core/bridge/pipeline/decomposer.py` mevcut, test geçiyor
- [ ] `core/bridge/pipeline/checkpoint.py` mevcut, test geçiyor
- [ ] `start_project` MCP tool `server.py`'de kayıtlı
- [ ] `pytest tests/test_discovery.py tests/test_decomposer.py -x` geçiyor
