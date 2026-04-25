import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/* ═══════════════════════════════════════════════════════════════════
   Alloy SettingsPanel — API keys, gateway config, preferences
   ═══════════════════════════════════════════════════════════════════ */
import { useState, useCallback } from "react";
import { Key, Server, Save, Eye, EyeOff, CheckCircle2, AlertTriangle, ExternalLink, Cpu } from "lucide-react";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/store/chatStore";
function SectionHeader({ icon, title }) {
    return (_jsxs("div", { className: "flex items-center gap-2 mb-2", children: [_jsx("span", { className: "text-[var(--alloy-text-muted)]", children: icon }), _jsx("span", { className: "text-[10px] font-semibold uppercase tracking-wider text-[var(--alloy-text-muted)]", children: title })] }));
}
function InputRow({ label, value, onChange, placeholder, type = "text", hint, }) {
    const [show, setShow] = useState(false);
    const inputType = type === "password" && !show ? "password" : "text";
    return (_jsxs("div", { className: "mb-3", children: [_jsx("label", { className: "block text-[11px] font-medium text-[var(--alloy-text-secondary)] mb-1", children: label }), _jsxs("div", { className: "relative flex items-center", children: [_jsx("input", { type: inputType, value: value, onChange: (e) => onChange(e.target.value), placeholder: placeholder, className: cn("w-full px-2.5 py-1.5 rounded-md text-[12px]", "bg-[var(--alloy-bg-primary)] border border-[var(--alloy-border-default)]", "text-[var(--alloy-text-primary)] placeholder:text-[var(--alloy-text-muted)]", "focus:border-[var(--alloy-accent)] focus:outline-none", "transition-colors duration-150", type === "password" && "pr-8") }), type === "password" && (_jsx("button", { type: "button", onClick: () => setShow(!show), className: "absolute right-2 text-[var(--alloy-text-muted)] hover:text-[var(--alloy-text-secondary)]", children: show ? _jsx(EyeOff, { className: "w-3.5 h-3.5" }) : _jsx(Eye, { className: "w-3.5 h-3.5" }) }))] }), hint && (_jsx("p", { className: "mt-1 text-[10px] text-[var(--alloy-text-muted)] leading-relaxed", children: hint }))] }));
}
export function SettingsPanel({ postMessage }) {
    const { availableModels } = useChatStore();
    const [anthropicKey, setAnthropicKey] = useState("");
    const [gatewayUrl, setGatewayUrl] = useState("http://127.0.0.1:51122");
    const [saved, setSaved] = useState(false);
    const [saveError, setSaveError] = useState("");
    const handleSave = useCallback(() => {
        if (!anthropicKey && !gatewayUrl)
            return;
        try {
            postMessage({ type: "saveSettings", value: JSON.stringify({ anthropicKey, gatewayUrl }) });
            setSaved(true);
            setSaveError("");
            setTimeout(() => setSaved(false), 2000);
        }
        catch {
            setSaveError("Save failed — please reload VS Code.");
        }
    }, [anthropicKey, gatewayUrl, postMessage]);
    const modelCount = availableModels.length;
    return (_jsxs("div", { className: "flex flex-col h-full bg-[var(--alloy-bg-primary)]", children: [_jsx("div", { className: "flex items-center px-4 py-3 border-b border-[var(--alloy-border-subtle)] shrink-0", children: _jsx("h2", { className: "text-[13px] font-semibold text-[var(--alloy-text-primary)]", children: "Settings" }) }), _jsxs("div", { className: "flex-1 overflow-y-auto p-4 space-y-5", children: [_jsxs("section", { children: [_jsx(SectionHeader, { icon: _jsx(Key, { className: "w-3.5 h-3.5" }), title: "Claude \u00B7 Anthropic" }), _jsxs("div", { className: "rounded-lg border border-[var(--alloy-border-default)] bg-[var(--alloy-bg-secondary)] p-3", children: [_jsx(InputRow, { label: "API Key", value: anthropicKey, onChange: setAnthropicKey, placeholder: "sk-ant-api\u2026", type: "password", hint: "Get your key at console.anthropic.com \u2014 saved to VS Code settings." }), _jsxs("a", { href: "https://console.anthropic.com/settings/keys", className: "inline-flex items-center gap-1 text-[10px] text-[var(--alloy-accent)] hover:underline", children: [_jsx(ExternalLink, { className: "w-3 h-3" }), "Open Anthropic Console"] })] })] }), _jsxs("section", { children: [_jsx(SectionHeader, { icon: _jsx(Server, { className: "w-3.5 h-3.5" }), title: "Gateway Server" }), _jsx("div", { className: "rounded-lg border border-[var(--alloy-border-default)] bg-[var(--alloy-bg-secondary)] p-3", children: _jsx(InputRow, { label: "Gateway URL", value: gatewayUrl, onChange: setGatewayUrl, placeholder: "http://127.0.0.1:51122", hint: "Default: http://127.0.0.1:51122 \u2014 start the bridge server before connecting Google." }) })] }), modelCount > 0 && (_jsxs("section", { children: [_jsx(SectionHeader, { icon: _jsx(Cpu, { className: "w-3.5 h-3.5" }), title: "Loaded Models" }), _jsxs("div", { className: "rounded-lg border border-[var(--alloy-border-default)] bg-[var(--alloy-bg-secondary)] p-3", children: [_jsxs("p", { className: "text-[11px] text-[var(--alloy-text-secondary)]", children: [modelCount, " model", modelCount !== 1 ? "s" : "", " available"] }), _jsx("div", { className: "mt-2 space-y-1 max-h-32 overflow-y-auto", children: availableModels.map((m) => (_jsxs("div", { className: "flex items-center gap-2 min-w-0", children: [_jsx("span", { className: "w-1.5 h-1.5 rounded-full bg-[var(--alloy-success)] shrink-0" }), _jsx("span", { className: "text-[11px] text-[var(--alloy-text-primary)] truncate min-w-0", children: m.name }), _jsx("span", { className: "text-[10px] text-[var(--alloy-text-muted)] shrink-0", children: m.provider })] }, m.id))) })] })] })), _jsxs("button", { onClick: handleSave, disabled: !anthropicKey && gatewayUrl === "http://127.0.0.1:51122", className: cn("w-full flex items-center justify-center gap-2 py-2 rounded-lg text-[12px] font-medium", "transition-colors duration-150", saved
                            ? "bg-[var(--alloy-success)] text-white"
                            : "bg-[var(--alloy-accent)] text-white hover:bg-[var(--alloy-accent-hover)]", "disabled:opacity-40 disabled:cursor-not-allowed"), children: [saved ? _jsx(CheckCircle2, { className: "w-3.5 h-3.5" }) : _jsx(Save, { className: "w-3.5 h-3.5" }), saved ? "Saved!" : "Save Settings"] }), saveError && (_jsxs("div", { className: "flex items-center gap-2 p-2 rounded-lg bg-[rgba(239,68,68,0.08)] border border-[rgba(239,68,68,0.15)]", children: [_jsx(AlertTriangle, { className: "w-3.5 h-3.5 text-[var(--alloy-error)] shrink-0" }), _jsx("span", { className: "text-[11px] text-[var(--alloy-error)]", children: saveError })] })), _jsxs("section", { className: "rounded-lg border border-[var(--alloy-border-subtle)] bg-[var(--alloy-bg-secondary)] p-3", children: [_jsx("p", { className: "text-[11px] font-medium text-[var(--alloy-text-secondary)] mb-1.5", children: "Start Bridge Server" }), _jsx("code", { className: "block text-[10px] font-mono bg-[var(--alloy-bg-tertiary)] rounded px-2 py-1.5 text-[var(--alloy-text-secondary)] break-all", children: "cd alloy-core/bridge && python -m uvicorn bridge:app --port 51122" })] })] })] }));
}
