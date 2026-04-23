import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/* ═══════════════════════════════════════════════════════════════════
   Alloy ModelSelector — Model selection with tier, cost & provider badges
   ═══════════════════════════════════════════════════════════════════ */
import { useState, useRef, useEffect } from "react";
import { ChevronDown, Cpu, Zap, Search, Sparkles, Gauge } from "lucide-react";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/store/chatStore";
import { Badge } from "@/components/shared";
function getModelMeta(model) {
    const id = model.id.toLowerCase();
    const name = model.name.toLowerCase();
    // Flagship / most capable
    if (id.includes("opus") ||
        id.includes("ultra") ||
        id.includes("gemini-2.0-pro") ||
        id.includes("gpt-4o") ||
        name.includes("opus") ||
        name.includes("ultra")) {
        return { tier: "Flagship", cost: "$$$", tierColor: "text-[#a78bfa]" };
    }
    // Fast / lightweight
    if (id.includes("haiku") ||
        id.includes("flash") ||
        id.includes("mini") ||
        id.includes("nano") ||
        id.includes("3.5") ||
        name.includes("haiku") ||
        name.includes("flash") ||
        name.includes("mini")) {
        return { tier: "Fast", cost: "$", tierColor: "text-[var(--alloy-success)]" };
    }
    // Smart but mid-tier
    if (id.includes("sonnet") ||
        id.includes("gemini-2.0") ||
        id.includes("gemini-1.5-pro") ||
        id.includes("gpt-4") ||
        name.includes("sonnet") ||
        name.includes("pro")) {
        return { tier: "Smart", cost: "$$", tierColor: "text-[var(--alloy-accent)]" };
    }
    return { tier: "Balanced", cost: "$$", tierColor: "text-[var(--alloy-info)]" };
}
function getTierIcon(tier) {
    switch (tier) {
        case "Flagship": return _jsx(Sparkles, { className: "w-3 h-3" });
        case "Smart": return _jsx(Zap, { className: "w-3 h-3" });
        case "Fast": return _jsx(Gauge, { className: "w-3 h-3" });
        default: return _jsx(Zap, { className: "w-3 h-3" });
    }
}
const PROVIDER_COLORS = {
    openai: { text: "text-green-400", dot: "bg-green-400" },
    anthropic: { text: "text-orange-400", dot: "bg-orange-400" },
    google: { text: "text-blue-400", dot: "bg-blue-400" },
    meta: { text: "text-purple-400", dot: "bg-purple-400" },
    mistral: { text: "text-cyan-400", dot: "bg-cyan-400" },
};
function providerKey(provider) {
    const p = provider.toLowerCase();
    for (const key of Object.keys(PROVIDER_COLORS)) {
        if (p.includes(key))
            return key;
    }
    return "";
}
/* ── Component ───────────────────────────────────────────────────── */
export function ModelSelector() {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState("");
    const ref = useRef(null);
    const inputRef = useRef(null);
    const { availableModels, selectedModel, setSelectedModel } = useChatStore();
    const currentModel = availableModels.find((m) => m.id === selectedModel);
    const currentMeta = currentModel ? getModelMeta(currentModel) : null;
    const filtered = availableModels.filter((m) => m.name.toLowerCase().includes(search.toLowerCase()) ||
        m.provider.toLowerCase().includes(search.toLowerCase()));
    // Group by provider
    const grouped = filtered.reduce((acc, m) => {
        (acc[m.provider] ??= []).push(m);
        return acc;
    }, {});
    useEffect(() => {
        if (open && inputRef.current)
            inputRef.current.focus();
    }, [open]);
    useEffect(() => {
        function handleClickOutside(e) {
            if (ref.current && !ref.current.contains(e.target)) {
                setOpen(false);
                setSearch("");
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);
    return (_jsxs("div", { ref: ref, className: "relative", children: [_jsxs("button", { onClick: () => setOpen(!open), className: cn("flex items-center gap-1.5 px-2 py-1 rounded-md text-xs", "bg-[var(--alloy-bg-tertiary)] border border-[var(--alloy-border-default)]", "hover:bg-[var(--alloy-bg-hover)] transition-colors duration-100", "text-[var(--alloy-text-secondary)] hover:text-[var(--alloy-text-primary)]"), children: [_jsx(Cpu, { className: "w-3 h-3 text-[var(--alloy-accent)] shrink-0" }), _jsx("span", { className: "max-w-[110px] truncate", children: currentModel?.name ?? "Select Model" }), currentMeta && (_jsx("span", { className: "text-[9px] text-[var(--alloy-text-muted)]", children: currentMeta.cost })), _jsx(ChevronDown, { className: cn("w-3 h-3 shrink-0 transition-transform duration-150", open && "rotate-180") })] }), open && (_jsxs("div", { className: cn("absolute bottom-full left-0 mb-1 w-72 z-50", "bg-[var(--alloy-bg-elevated)] border border-[var(--alloy-border-default)]", "rounded-lg shadow-[var(--alloy-shadow-lg)]", "animate-slide-down overflow-hidden"), children: [_jsx("div", { className: "p-2 border-b border-[var(--alloy-border-subtle)]", children: _jsxs("div", { className: "flex items-center gap-1.5 px-2 py-1.5 bg-[var(--alloy-bg-tertiary)] rounded-md", children: [_jsx(Search, { className: "w-3 h-3 text-[var(--alloy-text-muted)]" }), _jsx("input", { ref: inputRef, type: "text", value: search, onChange: (e) => setSearch(e.target.value), placeholder: "Search models\u2026", className: "flex-1 bg-transparent text-xs text-[var(--alloy-text-primary)] placeholder:text-[var(--alloy-text-muted)] outline-none" })] }) }), _jsxs("div", { className: "flex items-center gap-3 px-3 py-1.5 border-b border-[var(--alloy-border-subtle)] bg-[var(--alloy-bg-secondary)]", children: [["Fast", "Smart", "Flagship"].map((t) => {
                                const color = t === "Fast" ? "text-[var(--alloy-success)]" :
                                    t === "Smart" ? "text-[var(--alloy-accent)]" :
                                        "text-[#a78bfa]";
                                return (_jsxs("span", { className: cn("flex items-center gap-0.5 text-[9px] font-medium", color), children: [getTierIcon(t), t] }, t));
                            }), _jsx("span", { className: "ml-auto text-[9px] text-[var(--alloy-text-muted)]", children: "$ = cost" })] }), _jsxs("div", { className: "max-h-52 overflow-y-auto p-1", children: [Object.entries(grouped).map(([provider, models]) => {
                                const pKey = providerKey(provider);
                                const colors = PROVIDER_COLORS[pKey];
                                return (_jsxs("div", { children: [_jsxs("div", { className: "flex items-center gap-1.5 px-2 py-1", children: [colors && (_jsx("span", { className: cn("w-1.5 h-1.5 rounded-full shrink-0", colors.dot) })), _jsx("span", { className: "text-[10px] uppercase tracking-wider text-[var(--alloy-text-muted)] font-semibold", children: provider })] }), models.map((model) => {
                                            const meta = getModelMeta(model);
                                            const isSelected = model.id === selectedModel;
                                            return (_jsxs("button", { onClick: () => {
                                                    setSelectedModel(model.id);
                                                    setOpen(false);
                                                    setSearch("");
                                                }, className: cn("w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors", isSelected
                                                    ? "bg-[var(--alloy-accent-subtle)]"
                                                    : "hover:bg-[var(--alloy-bg-hover)]"), children: [_jsx("span", { className: cn("shrink-0", meta.tierColor), children: getTierIcon(meta.tier) }), _jsx("span", { className: cn("truncate flex-1 text-left font-medium", isSelected
                                                            ? "text-[var(--alloy-accent)]"
                                                            : "text-[var(--alloy-text-primary)]"), children: model.name }), _jsx("span", { className: cn("shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-full border", meta.tier === "Flagship"
                                                            ? "border-[#7c3aed30] bg-[#7c3aed12] text-[#a78bfa]"
                                                            : meta.tier === "Smart"
                                                                ? "border-[var(--alloy-accent-muted)] bg-[var(--alloy-accent-subtle)] text-[var(--alloy-accent)]"
                                                                : meta.tier === "Fast"
                                                                    ? "border-[rgba(34,197,94,0.2)] bg-[rgba(34,197,94,0.08)] text-[var(--alloy-success)]"
                                                                    : "border-[var(--alloy-border-default)] bg-[var(--alloy-bg-tertiary)] text-[var(--alloy-text-muted)]"), children: meta.tier }), _jsx("span", { className: "shrink-0 text-[9px] text-[var(--alloy-text-muted)] font-mono w-5 text-right", children: meta.cost }), model.status === "rate_limited" && (_jsx(Badge, { variant: "warning", size: "xs", children: "Limited" })), model.status === "offline" && (_jsx(Badge, { variant: "error", size: "xs", children: "Offline" }))] }, model.id));
                                        })] }, provider));
                            }), filtered.length === 0 && (_jsx("div", { className: "px-2 py-4 text-xs text-[var(--alloy-text-muted)] text-center", children: "No models found" }))] }), _jsx("div", { className: "px-3 py-1.5 border-t border-[var(--alloy-border-subtle)] bg-[var(--alloy-bg-secondary)]", children: _jsxs("span", { className: "text-[9px] text-[var(--alloy-text-muted)]", children: [availableModels.length, " model", availableModels.length !== 1 ? "s" : "", " available across ", Object.keys(grouped).length, " provider", Object.keys(grouped).length !== 1 ? "s" : ""] }) })] }))] }));
}
