import os
import shutil

def rebrand_to_sovereign(root_dir):
    print(f"Starting forensic rebrand to Sovereign AI in {root_dir}")
    
    # 1. Patterns to replace (Specific to General)
    replacements = [
        ("Sovereign AI", "Sovereign AI"),
        ("Sovereign AI contributors", "Sovereign AI contributors"),
        ("Sovereign AI Gateway", "Sovereign AI Gateway"),
        ("Sovereign Dashboard", "Sovereign Dashboard"),
        ("SovereignGatewayAuthorization", "SovereignGatewayAuthorization"),
        ("SovereignGatewayClient", "SovereignGatewayClient"),
        ("SovereignGatewayConfig", "SovereignGatewayConfig"),
        ("GoogleGeminiProvider", "GoogleGeminiProvider"),
        ("authorizeGoogleGemini", "authorizeGoogleGemini"),
        ("exchangeGoogleGemini", "exchangeGoogleGemini"),
        ("GOOGLE_GEMINI_PROVIDER_ID", "GOOGLE_GEMINI_PROVIDER_ID"),
        ("AIProvider.GOOGLE_GEMINI", "AIProvider.GOOGLE_GEMINI"),
        ("GOOGLE_GEMINI", "GOOGLE_GEMINI"),
        ("google_gemini", "google_gemini"),
        ("google_gemini", "google_gemini"),
        ("google-gemini-tokens.json", "google-gemini-tokens.json"),
        ("Sovereign", "Sovereign"),
        ("sovereign-ai", "sovereign-ai"),
        ("sovereign", "sovereign"),
        ("Sovereign", "Sovereign"),
        ("sovereign", "sovereign"),
    ]

    # Special logic for import paths and filenames (case boundary sensitive)
    import_replacements = [
        ("../sovereign/", "../google-gemini/"),
        ("../../sovereign/", "../../google-gemini/"),
        ("../sovereign-client", "./gateway-client"),
        ("../../src/orchestration/sovereign-client", "../../src/orchestration/gateway-client"),
        ("./sovereign-client", "./gateway-client"),
        ("./sovereign-api", "./gateway-api"),
        ("./sovereign-utils", "./gateway-utils"),
        ("sovereign-ai", "sovereign-ai"),
    ]

    # Uppercase SOVEREIGN (excluding the fallback)
    uppercase_replacements = [
        ("SOVEREIGN_", "SOVEREIGN_"),
        ("SOVEREIGN", "SOVEREIGN"),
    ]

    skip_dirs = ['node_modules', '.git', 'dist', 'coverage', '__pycache__', '.venv', 'venv', '.next', 'build', 'artifacts', 'brain']
    skip_files = ['AUDIT_FINDINGS.md', 'AUDIT_VERIFICATION.md', 'rebrand_to_sovereign.py', 'rebrand-to-sovereign.sh']

    for root, dirs, files in os.walk(root_dir):
        dirs[:] = [d for d in dirs if d not in skip_dirs]
        
        for file in files:
            if file in skip_files: continue
            if not any(file.endswith(ext) for ext in ['.ts', '.tsx', '.js', '.jsx', '.py', '.md', '.json', '.css', '.html', '.sh', '.yml', '.yaml', '.txt']):
                continue
                
            file_path = os.path.join(root, file)
            try:
                with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                    content = f.read()
                
                updated = content
                
                # Check for x-Sovereign- headers and preserve them
                # Temporarily replace them with markers
                headers = [
                    "x-LojiNext-total-token-count",
                    "x-LojiNext-prompt-token-count",
                    "x-LojiNext-candidates-token-count",
                    "x-LojiNext-cached-content-token-count"
                ]
                for i, h in enumerate(headers):
                    updated = updated.replace(h, f"__HEADER_{i}__")
                
                # Preserve LOJINEXT_GATEWAY_TOKEN
                updated = updated.replace("LOJINEXT_GATEWAY_TOKEN", "LOJINEXT_GATEWAY_TOKEN")

                # Apply replacements
                for old, new in replacements:
                    updated = updated.replace(old, new)
                for old, new in import_replacements:
                    updated = updated.replace(old, new)
                for old, new in uppercase_replacements:
                    updated = updated.replace(old, new)
                
                # Restore headers and env
                for i, h in enumerate(headers):
                    updated = updated.replace(f"__HEADER_{i}__", h)
                updated = updated.replace("LOJINEXT_GATEWAY_TOKEN", "LOJINEXT_GATEWAY_TOKEN")

                if updated != content:
                    with open(file_path, 'w', encoding='utf-8') as f:
                        f.write(updated)
                    print(f"Processed: {file_path}")
            except Exception as e:
                print(f"Error processing {file_path}: {e}")

    # 2. Rename files/directories
    renames = [
        ("AGENT/src/sovereign", "AGENT/src/google-gemini"),
        ("AGENT/src/orchestration/sovereign-client.ts", "AGENT/src/orchestration/gateway-client.ts"),
        ("AGENT/src/orchestration/sovereign-api.ts", "AGENT/src/orchestration/gateway-api.ts"),
        ("AGENT/src/orchestration/sovereign-api.test.ts", "AGENT/src/orchestration/gateway-api.test.ts"),
        ("AGENT/src/orchestration/sovereign-utils.ts", "AGENT/src/orchestration/gateway-utils.ts"),
        ("AGENT/src/plugin/sovereign-first-fallback.test.ts", "AGENT/src/plugin/gateway-first-fallback.test.ts"),
    ]

    for src, dst in renames:
        src_path = os.path.join(root_dir, src)
        dst_path = os.path.join(root_dir, dst)
        if os.path.exists(src_path):
            try:
                if os.path.isdir(src_path) and os.path.exists(dst_path):
                    shutil.rmtree(dst_path) # Clean up if it already exists
                os.rename(src_path, dst_path)
                print(f"Renamed: {src} -> {dst}")
            except Exception as e:
                print(f"Error renaming {src}: {e}")

if __name__ == "__main__":
    rebrand_to_sovereign("d:/PROJECT/agent-stack")
