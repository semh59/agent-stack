import asyncio
import unittest
from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop
from aiohttp import web
from config import settings
from bridge import create_app, _get_orch
from pathlib import Path
import sys

# Ensure proper paths
sys.path.insert(0, str(Path(__file__).parent.parent))

class BridgeAPITestCase(AioHTTPTestCase):
    async def get_application(self):
        # We need to create the web app and return it
        return create_app()

    @unittest_run_loop
    async def test_api_health(self):
        """Test public health probe."""
        resp = await self.client.request("GET", '/health')
        self.assertEqual(resp.status, 200)
        data = await resp.json()
        self.assertEqual(data["status"], "ok")

    @unittest_run_loop
    async def test_api_optimize_auth_fail(self):
        """Ensure bridge rejects unauthenticated payload."""
        resp = await self.client.request("POST", '/optimize', json={"message": "Test"})
        self.assertEqual(resp.status, 401)

    @unittest_run_loop
    async def test_api_optimize_tas_ghosting(self):
        """Deep integration test testing the full bridge with TAS over HTTP."""
        # Ensure bridge orchestrator is initialized to register anchors
        orch = await _get_orch()
        reg = orch.tas_registry
        if not reg.anchors:
            reg.bootstrap_core_anchors()

        # Get a valid anchor
        anchor_info = next(iter(reg.anchors.values()))
        
        # 1. Setup Request Payload
        raw_context = f"import {anchor_info['module']}\n" * 50
        headers = {"X-Bridge-Secret": settings.bridge_secret}
        payload = {
            "message": raw_context,
            "force_layers": ["tas_ghosting"]
        }
        
        # 2. Fire Request
        resp = await self.client.request("POST", '/optimize', json=payload, headers=headers)
        
        # In aiohttp tests, response text is awaited
        text = await resp.text()
        self.assertEqual(resp.status, 200, f"Expected 200, got: {text}")
        
        data = await resp.json()
        
        # 3. Assert TAS specific fields
        self.assertGreater(data["savings_percent"], 0)
        self.assertIn("TAS-ANC", data["optimized"])
        self.assertLess(len(data["optimized"]), len(raw_context))

if __name__ == '__main__':
    unittest.main()
