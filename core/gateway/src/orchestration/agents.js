"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AGENTS = exports.PreferredModel = exports.AgentLayer = void 0;
exports.getAgentByRole = getAgentByRole;
exports.getAgentsByLayer = getAgentsByLayer;
exports.getTotalEstimatedMinutes = getTotalEstimatedMinutes;
exports.getNextAgent = getNextAgent;
exports.validateAgentDefinitions = validateAgentDefinitions;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const js_yaml_1 = __importDefault(require("js-yaml"));
const node_url_1 = require("node:url");
// ESM/CJS absolute path resolution for prompts.yaml
const __dirnameResolved = (() => {
    try {
        // ESM path resolution
        if (typeof import.meta?.url === 'string') {
            return node_path_1.default.dirname((0, node_url_1.fileURLToPath)(import.meta.url));
        }
    }
    catch { /* fallback to CJS */ }
    // CJS fallback
    if (typeof __dirname !== 'undefined')
        return __dirname;
    // Last resort (might be wrong if started from different dir)
    return process.cwd();
})();
const PROMPTS_PATH = node_path_1.default.resolve(__dirnameResolved, 'prompts.yaml');
/**
 * Agent Definitions for Sequential Pipeline (Alloy AI - Phase 2)
 */
exports.AgentLayer = {
    MANAGEMENT: "management",
    DESIGN: "design",
    DEVELOPMENT: "development",
    QUALITY: "quality",
    OUTPUT: "output",
};
exports.PreferredModel = {
    OPUS: "google/alloy-claude-opus-4-6-thinking",
    SONNET: "google/alloy-claude-sonnet-4-6-thinking",
    GEMINI_PRO: "google/alloy-gemini-3-1-pro-high",
    GEMINI_FLASH: "google/alloy-gemini-3-flash",
};
// Load prompts from YAML
let prompts = {};
try {
    const loaded = js_yaml_1.default.load(node_fs_1.default.readFileSync(PROMPTS_PATH, 'utf8'));
    if (loaded && typeof loaded === 'object' && !Array.isArray(loaded)) {
        prompts = loaded;
    }
}
catch (err) {
    console.error('[Agents] Failed to load prompts.yaml:', err);
}
function getPrompt(role) {
    return prompts[role]?.system || `You are the ${role} agent.`;
}
exports.AGENTS = [
    {
        order: 1,
        role: "ceo",
        name: "CEO",
        emoji: "ğŸ¯",
        layer: exports.AgentLayer.MANAGEMENT,
        preferredModel: exports.PreferredModel.GEMINI_PRO,
        inputFiles: [],
        outputFiles: ["ceo-brief.md"],
        estimatedMinutes: 5,
        systemPrompt: getPrompt("ceo"),
        backtrackTargets: [],
        outputValidation: ['Problem Definition', 'Success Criteria', 'Technical Constraints', 'Out of Scope'],
    },
    {
        order: 2,
        role: "pm",
        name: "Project Manager",
        emoji: "ğŸ“‹",
        layer: exports.AgentLayer.MANAGEMENT,
        preferredModel: exports.PreferredModel.GEMINI_PRO,
        inputFiles: ["ceo-brief.md"],
        outputFiles: ["pm-plan.md"],
        estimatedMinutes: 5,
        systemPrompt: getPrompt("pm"),
        backtrackTargets: ['ceo'],
        outputValidation: ['User Stories', 'Acceptance Criteria', 'Priority Matrix', 'Phases', 'Dependencies'],
    },
    {
        order: 3,
        role: "architect",
        name: "Architect",
        emoji: "ğŸ—ï¸",
        layer: exports.AgentLayer.MANAGEMENT,
        preferredModel: exports.PreferredModel.OPUS,
        inputFiles: ["ceo-brief.md", "pm-plan.md"],
        outputFiles: ["architecture.md"],
        estimatedMinutes: 8,
        systemPrompt: getPrompt("architect"),
        verificationCommands: ['npm install --dry-run'],
        backtrackTargets: ['ceo', 'pm'],
        outputValidation: ['System Overview', 'Tech Stack', 'Components', 'Data Flow', 'Interfaces', 'ADRs'],
    },
    {
        order: 4,
        role: "ui_ux",
        name: "UI/UX Designer",
        emoji: "ğŸ¨",
        layer: exports.AgentLayer.DESIGN,
        preferredModel: exports.PreferredModel.SONNET,
        inputFiles: ["ceo-brief.md", "pm-plan.md", "architecture.md"],
        outputFiles: ["design-system.md"],
        estimatedMinutes: 5,
        systemPrompt: getPrompt("ui_ux"),
        backtrackTargets: ['architect'],
        outputValidation: ['Design Tokens', 'Component Hierarchy', 'User Flows', 'Responsive Breakpoints', 'Accessibility'],
    },
    {
        order: 5,
        role: "database",
        name: "Database Designer",
        emoji: "ğŸ—„ï¸",
        layer: exports.AgentLayer.DESIGN,
        preferredModel: exports.PreferredModel.SONNET,
        inputFiles: ["pm-plan.md", "architecture.md"],
        outputFiles: ["db-schema.md"],
        estimatedMinutes: 5,
        systemPrompt: getPrompt("database"),
        verificationCommands: ['npm run build'],
        backtrackTargets: ['architect'],
        outputValidation: ['Tables', 'Relationships', 'Indexes', 'Migrations', 'Seed Data'],
    },
    {
        order: 6,
        role: "api_designer",
        name: "API Designer",
        emoji: "ğŸ”Œ",
        layer: exports.AgentLayer.DESIGN,
        preferredModel: exports.PreferredModel.SONNET,
        inputFiles: ["architecture.md", "db-schema.md"],
        outputFiles: ["api-contracts.md"],
        estimatedMinutes: 5,
        systemPrompt: getPrompt("api_designer"),
        backtrackTargets: ['database', 'architect'],
        outputValidation: ['Endpoints', 'Schemas', 'Auth Requirements', 'Error Codes', 'Pagination Strategy'],
    },
    {
        order: 7,
        role: "backend",
        name: "Backend Developer",
        emoji: "âš™ï¸",
        layer: exports.AgentLayer.DEVELOPMENT,
        preferredModel: exports.PreferredModel.SONNET,
        inputFiles: ["architecture.md", "db-schema.md", "api-contracts.md"],
        outputFiles: ["backend-report.md"],
        estimatedMinutes: 10,
        systemPrompt: getPrompt("backend"),
        verificationCommands: ['npm run build', 'npm run test'],
        backtrackTargets: ['architect', 'database', 'api_designer'],
        outputValidation: ['Files Created', 'Key Decisions', 'Known Issues'],
    },
    {
        order: 8,
        role: "frontend",
        name: "Frontend Developer",
        emoji: "ğŸ–¥ï¸",
        layer: exports.AgentLayer.DEVELOPMENT,
        preferredModel: exports.PreferredModel.SONNET,
        inputFiles: ["design-system.md", "api-contracts.md", "architecture.md"],
        outputFiles: ["frontend-report.md"],
        estimatedMinutes: 10,
        systemPrompt: getPrompt("frontend"),
        verificationCommands: ['npm run build', 'npm run typecheck'],
        backtrackTargets: ['ui_ux', 'backend', 'architect'],
        outputValidation: ['Components Created', 'State Management', 'Known Issues'],
    },
    {
        order: 9,
        role: "auth",
        name: "Auth Developer",
        emoji: "ğŸ”",
        layer: exports.AgentLayer.DEVELOPMENT,
        preferredModel: exports.PreferredModel.SONNET,
        inputFiles: ["architecture.md", "api-contracts.md", "backend-report.md"],
        outputFiles: ["auth-report.md"],
        estimatedMinutes: 5,
        systemPrompt: getPrompt("auth"),
        verificationCommands: ['npm run build', 'npm run test'],
        backtrackTargets: ['backend', 'architect'],
        outputValidation: ['Auth Strategy', 'Endpoints Secured', 'Rate Limits', 'Token Management'],
    },
    {
        order: 10,
        role: "integration",
        name: "Integration Developer",
        emoji: "ğŸ”—",
        layer: exports.AgentLayer.DEVELOPMENT,
        preferredModel: exports.PreferredModel.SONNET,
        inputFiles: ["backend-report.md", "frontend-report.md", "auth-report.md"],
        outputFiles: ["integration-report.md"],
        estimatedMinutes: 5,
        systemPrompt: getPrompt("integration"),
        verificationCommands: ['npm run build'],
        backtrackTargets: ['backend', 'frontend'],
        outputValidation: ['Integrations Verified', 'Issues Found', 'Config Changes'],
    },
    {
        order: 11,
        role: "unit_test",
        name: "Unit Tester",
        emoji: "ğŸ§ª",
        layer: exports.AgentLayer.QUALITY,
        preferredModel: exports.PreferredModel.GEMINI_FLASH,
        inputFiles: ["backend-report.md", "frontend-report.md"],
        outputFiles: ["unit-test-report.md"],
        estimatedMinutes: 5,
        systemPrompt: getPrompt("unit_test"),
        verificationCommands: ['npm run test -- --coverage'],
        backtrackTargets: ['backend'],
        outputValidation: ['Tests Written', 'Coverage %', 'Pass/Fail Summary'],
    },
    {
        order: 12,
        role: "integration_test",
        name: "Integration Tester",
        emoji: "ğŸ”„",
        layer: exports.AgentLayer.QUALITY,
        preferredModel: exports.PreferredModel.GEMINI_FLASH,
        inputFiles: ["integration-report.md", "api-contracts.md"],
        outputFiles: ["integration-test-report.md"],
        estimatedMinutes: 5,
        systemPrompt: getPrompt("integration_test"),
        verificationCommands: ['npm run test'],
        backtrackTargets: ['integration', 'backend', 'frontend'],
        outputValidation: ['Test Scenarios', 'Pass/Fail Results', 'Issues Found'],
    },
    {
        order: 13,
        role: "security",
        name: "Security Auditor",
        emoji: "ğŸ›¡ï¸",
        layer: exports.AgentLayer.QUALITY,
        preferredModel: exports.PreferredModel.OPUS,
        inputFiles: ["auth-report.md", "api-contracts.md", "backend-report.md"],
        outputFiles: ["security-audit.md"],
        estimatedMinutes: 5,
        systemPrompt: getPrompt("security"),
        verificationCommands: ['npm audit', 'semgrep scan', 'snyk test'],
        backtrackTargets: ['backend', 'auth', 'architect'],
        outputValidation: ['OWASP Top 10 Check', 'Dependency Audit Results', 'Secret Scan Results', 'Severity Ratings'],
        haltConditions: ['Critical severity vulnerability found', 'Secret/API key leak detected'],
    },
    {
        order: 14,
        role: "performance",
        name: "Performance Engineer",
        emoji: "âš¡",
        layer: exports.AgentLayer.QUALITY,
        preferredModel: exports.PreferredModel.GEMINI_FLASH,
        inputFiles: ["backend-report.md", "frontend-report.md", "db-schema.md"],
        outputFiles: ["performance-report.md"],
        estimatedMinutes: 3,
        systemPrompt: getPrompt("performance"),
        backtrackTargets: ['backend', 'database', 'frontend'],
        outputValidation: ['Bottlenecks Found', 'Optimization Recommendations', 'Priority Ranking'],
    },
    {
        order: 15,
        role: "code_review",
        name: "Code Reviewer",
        emoji: "ğŸ‘ï¸",
        layer: exports.AgentLayer.QUALITY,
        preferredModel: exports.PreferredModel.OPUS,
        inputFiles: ["backend-report.md", "frontend-report.md", "security-audit.md", "performance-report.md", "unit-test-report.md"],
        outputFiles: ["code-review.md"],
        estimatedMinutes: 5,
        systemPrompt: getPrompt("code_review"),
        verificationCommands: ['npx tsc --noEmit'],
        backtrackTargets: ['backend', 'frontend'],
        outputValidation: ['Review Findings', 'Severity Ratings', 'Final Verdict', 'Action Items'],
    },
    {
        order: 16,
        role: "docs",
        name: "Documentation Writer",
        emoji: "ğŸ“š",
        layer: exports.AgentLayer.OUTPUT,
        preferredModel: exports.PreferredModel.GEMINI_FLASH,
        inputFiles: ["architecture.md", "api-contracts.md", "code-review.md"],
        outputFiles: ["documentation.md"],
        estimatedMinutes: 3,
        systemPrompt: getPrompt("docs"),
        backtrackTargets: [],
        outputValidation: ['API Documentation', 'Setup Guide', 'Configuration Reference'],
    },
    {
        order: 17,
        role: "tech_writer",
        name: "Tech Writer",
        emoji: "ğŸ“",
        layer: exports.AgentLayer.OUTPUT,
        preferredModel: exports.PreferredModel.GEMINI_FLASH,
        inputFiles: ["documentation.md", "pm-plan.md"],
        outputFiles: ["changelog-entry.md"],
        estimatedMinutes: 3,
        systemPrompt: getPrompt("tech_writer"),
        backtrackTargets: [],
        outputValidation: ['Changelog Entry', 'Release Notes'],
    },
    {
        order: 18,
        role: "devops",
        name: "DevOps Engineer",
        emoji: "🚀",
        layer: exports.AgentLayer.OUTPUT,
        preferredModel: exports.PreferredModel.SONNET,
        inputFiles: ["architecture.md", "code-review.md", "security-audit.md", "performance-report.md"],
        outputFiles: ["deployment-plan.md"],
        estimatedMinutes: 5,
        systemPrompt: getPrompt("devops"),
        verificationCommands: ['npm run build', 'npm run test'],
        backtrackTargets: ['backend', 'security'],
        outputValidation: ['Build Status', 'Deployment Config', 'Rollback Plan', 'Deployment Checklist'],
        haltConditions: ['Production deployment requires human approval'],
    },
    {
        order: 19,
        role: "qa_edgecase",
        name: "QA Edge-Case Specialist",
        emoji: "🧪",
        layer: exports.AgentLayer.QUALITY,
        preferredModel: exports.PreferredModel.OPUS,
        inputFiles: ["backend-report.md", "frontend-report.md", "api-contracts.md"],
        outputFiles: ["edge-case-audit.md"],
        estimatedMinutes: 8,
        systemPrompt: getPrompt("qa_edgecase"),
        backtrackTargets: ["backend", "frontend", "api_designer"],
        outputValidation: ["Race Conditions", "Input Stress Tests", "State Recovery"],
    },
    {
        order: 20,
        role: "rag_specialist",
        name: "RAG & Context Specialist",
        emoji: "🧠",
        layer: exports.AgentLayer.QUALITY,
        preferredModel: exports.PreferredModel.SONNET,
        inputFiles: ["architecture.md", "documentation.md", "backend-report.md"],
        outputFiles: ["context-optimization.md"],
        estimatedMinutes: 5,
        systemPrompt: getPrompt("rag_specialist"),
        backtrackTargets: ["architect", "docs"],
        outputValidation: ["AST Correspondence", "Noise Pruning", "Citation Integrity"],
    },
];
function getAgentByRole(role) {
    return exports.AGENTS.find((a) => a.role === role);
}
function getAgentsByLayer(layer) {
    return exports.AGENTS.filter((a) => a.layer === layer);
}
function getTotalEstimatedMinutes() {
    return exports.AGENTS.reduce((sum, a) => sum + a.estimatedMinutes, 0);
}
function getNextAgent(currentOrder) {
    return exports.AGENTS.find((a) => a.order === currentOrder + 1);
}
function validateAgentDefinitions() {
    const errors = [];
    const roles = new Set();
    const orders = new Set();
    const allRoles = new Set(exports.AGENTS.map(a => a.role));
    for (const agent of exports.AGENTS) {
        if (roles.has(agent.role))
            errors.push(`Duplicate role: ${agent.role}`);
        roles.add(agent.role);
        if (orders.has(agent.order))
            errors.push(`Duplicate order: ${agent.order}`);
        orders.add(agent.order);
        if (!agent.systemPrompt || agent.systemPrompt.trim().length === 0) {
            errors.push(`Agent ${agent.role} has empty systemPrompt (check prompts.yaml)`);
        }
        if (agent.outputFiles.length === 0)
            errors.push(`Agent ${agent.role} has no outputFiles`);
        if (agent.backtrackTargets) {
            for (const target of agent.backtrackTargets) {
                if (!allRoles.has(target))
                    errors.push(`Agent ${agent.role} has invalid backtrackTarget: ${target}`);
            }
        }
    }
    for (let i = 1; i <= exports.AGENTS.length; i++) {
        if (!orders.has(i))
            errors.push(`Missing agent with order: ${i}`);
    }
    return { valid: errors.length === 0, errors };
}
//# sourceMappingURL=agents.js.map