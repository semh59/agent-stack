"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskScheduler = void 0;
const DependencyGraph_1 = require("./DependencyGraph");
/**
 * TaskScheduler: An event-driven engine that manages parallel agent execution.
 * Decouples task lifecycle from orchestration logic to optimize for performance and scalability.
 */
class TaskScheduler {
    graph;
    maxConcurrency;
    activeCount = 0;
    taskStatuses = new Map();
    queue = [];
    graphNodes = [];
    abortControllers = new Map();
    isAborted = false;
    constructor(options = {}) {
        this.graph = options.graph ?? new DependencyGraph_1.DependencyGraph();
        this.maxConcurrency = options.maxConcurrency ?? 4;
    }
    /**
     * Initialize the scheduler with a set of agents to run.
     */
    init(agents) {
        this.graphNodes = agents.map(a => a.role);
        for (const agent of agents) {
            const deps = this.graph.getDependencies(agent.role);
            const isReady = deps.every(d => !this.graphNodes.includes(d));
            this.taskStatuses.set(agent.role, {
                role: agent.role,
                state: isReady ? 'ready' : 'pending',
            });
            if (isReady) {
                this.queue.push(agent.role);
            }
        }
    }
    /**
     * Dispatches ready tasks while respecting concurrency limits.
     * Returns roles that should be executed.
     */
    dispatch() {
        if (this.isAborted)
            return [];
        const toExecute = [];
        while (this.activeCount < this.maxConcurrency && this.queue.length > 0) {
            const role = this.queue.shift();
            const status = this.taskStatuses.get(role);
            status.state = 'running';
            this.activeCount++;
            this.abortControllers.set(role, new AbortController());
            toExecute.push(role);
        }
        return toExecute;
    }
    getSignal(role) {
        return this.abortControllers.get(role)?.signal;
    }
    abortAll() {
        this.isAborted = true;
        for (const controller of this.abortControllers.values()) {
            controller.abort('Pipeline Failure');
        }
    }
    /**
     * Marks a task as completed and updates its dependents.
     */
    complete(role) {
        const status = this.taskStatuses.get(role);
        if (!status)
            return;
        status.state = 'completed';
        this.activeCount--;
        // Proactively check dependents to reduce time complexity
        const dependents = this.graph.getDependents(role);
        for (const depRole of dependents) {
            const depStatus = this.taskStatuses.get(depRole);
            if (depStatus && depStatus.state === 'pending') {
                const allDepsMet = this.graph.getDependencies(depRole).every(d => {
                    const s = this.taskStatuses.get(d);
                    return !this.graphNodes.includes(d) || (s && s.state === 'completed');
                });
                if (allDepsMet) {
                    depStatus.state = 'ready';
                    this.queue.push(depRole);
                }
            }
        }
    }
    /**
     * Marks a task as failed.
     */
    fail(role, error) {
        const status = this.taskStatuses.get(role);
        if (!status)
            return;
        status.state = 'failed';
        status.error = error;
        this.activeCount--;
    }
    /**
     * Returns true if all tasks are finished.
     */
    isDone() {
        return Array.from(this.taskStatuses.values()).every(s => s.state === 'completed' || s.state === 'failed' || s.state === 'skipped');
    }
    /**
     * Returns current snapshot of statuses for monitoring.
     */
    getSnaphot() {
        return Array.from(this.taskStatuses.values());
    }
    getActiveCount() {
        return this.activeCount;
    }
}
exports.TaskScheduler = TaskScheduler;
//# sourceMappingURL=TaskScheduler.js.map