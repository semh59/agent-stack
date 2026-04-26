import http.server
import json
import socketserver
import sys
import argparse

class StubBridgeHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/health':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                "status": "ok",
                "service": "ai-stack-optimization-bridge",
                "initialized": True
            }).encode())
        elif self.path == '/cache-stats':
            if not self._check_auth(): return
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                "exact": {"hits": 10, "misses": 5},
                "semantic": {"hits": 2, "misses": 8}
            }).encode())
        else:
            self.send_error(404)

    def do_POST(self):
        if self.path == '/optimize':
            if not self._check_auth(): return
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data)
            
            message = data.get("message", "")
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                "optimized": f"STUB_OPTIMIZED: {message}",
                "tokens_saved": 100,
                "savings_percent": 30.5,
                "cache_hit": False,
                "layers_applied": ["cleaning", "compression"]
            }).encode())
        elif self.path == '/index':
            if not self._check_auth(): return
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"status": "indexed", "id": "stub-1"}).encode())
        elif self.path == '/search':
            if not self._check_auth(): return
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                "results": [{"content": "Alloy is a premium agentic platform.", "score": 0.9}]
            }).encode())
        else:
            self.send_error(404)

    def _check_auth(self):
        secret = self.headers.get('X-Bridge-Secret')
        import os
        expected = os.environ.get('ALLOY_BRIDGE_SECRET', 'test-secret-12345')
        if secret != expected:
            self.send_response(401)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Unauthorized"}).encode())
            return False
        return True

def run(port=9100):
    server_address = ('127.0.0.1', port)
    httpd = http.server.HTTPServer(server_address, StubBridgeHandler)
    print(f"Stub Bridge running on port {port}...")
    httpd.serve_forever()

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=9100)
    args = parser.parse_args()
    run(port=args.port)
