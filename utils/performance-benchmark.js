// Performance Benchmark Utility for CommsFinder
// Tracks timing for each step in the scanning process

export class PerformanceBenchmark {
    constructor(platform) {
        this.platform = platform;
        this.steps = new Map(); // Map of step name to array of durations
        this.currentStep = null;
        this.currentStepStart = null;
        this.totalStartTime = null;
        this.profileCount = 0;
        // Enable benchmarking by default for performance monitoring
        this.isEnabled = true;
        this.totalStartTime = performance.now();
    }

    // Enable or disable benchmarking
    enable() {
        this.isEnabled = true;
        if (!this.totalStartTime) {
            this.totalStartTime = performance.now();
        }
        console.log(`[Benchmark] Enabled for ${this.platform}`);
    }

    disable() {
        this.isEnabled = false;
        console.log(`[Benchmark] Disabled for ${this.platform}`);
    }

    // Start timing a step
    startStep(stepName) {
        if (!this.isEnabled || !stepName) return;

        // End previous step if one is active
        if (this.currentStep && this.currentStepStart !== null) {
            this.endStep();
        }

        this.currentStep = stepName;
        this.currentStepStart = performance.now();
    }

    // End timing a step
    endStep() {
        if (!this.isEnabled) {
            return;
        }
        
        // Only process if we have an active step
        if (!this.currentStep || this.currentStepStart === null) {
            return;
        }

        const duration = performance.now() - this.currentStepStart;
        
        if (!this.steps.has(this.currentStep)) {
            this.steps.set(this.currentStep, []);
        }
        
        this.steps.get(this.currentStep).push(duration);
        
        console.log(`[Benchmark] ${this.currentStep}: ${duration.toFixed(2)}ms`);
        
        this.currentStep = null;
        this.currentStepStart = null;
    }

    // Increment profile count
    incrementProfileCount() {
        this.profileCount++;
    }

    // Get benchmark results
    getResults() {
        if (!this.isEnabled) {
            return null;
        }

        const totalTime = this.totalStartTime ? 
            performance.now() - this.totalStartTime : 0;

        const stepStats = [];
        
        for (const [stepName, durations] of this.steps.entries()) {
            const total = durations.reduce((sum, d) => sum + d, 0);
            const average = durations.length > 0 ? total / durations.length : 0;
            const min = durations.length > 0 ? Math.min(...durations) : 0;
            const max = durations.length > 0 ? Math.max(...durations) : 0;
            const count = durations.length;

            stepStats.push({
                step: stepName,
                count: count,
                totalMs: total,
                totalSeconds: total / 1000,
                averageMs: average,
                averageSeconds: average / 1000,
                minMs: min,
                maxMs: max,
                percentage: totalTime > 0 ? (total / totalTime) * 100 : 0
            });
        }

        // Sort by total time descending
        stepStats.sort((a, b) => b.totalMs - a.totalMs);

        return {
            platform: this.platform,
            profileCount: this.profileCount,
            totalTimeMs: totalTime,
            totalTimeSeconds: totalTime / 1000,
            steps: stepStats,
            timestamp: Date.now()
        };
    }

    // Reset benchmark data
    reset() {
        this.steps.clear();
        this.currentStep = null;
        this.currentStepStart = null;
        this.totalStartTime = performance.now();
        this.profileCount = 0;
    }

    // Get summary for quick display
    getSummary() {
        const results = this.getResults();
        if (!results) return null;

        return {
            platform: this.platform,
            profiles: this.profileCount,
            totalTime: `${(results.totalTimeSeconds).toFixed(1)}s`,
            topSteps: results.steps.slice(0, 5).map(s => ({
                name: s.step,
                total: `${(s.totalSeconds).toFixed(1)}s`,
                avg: `${(s.averageMs).toFixed(0)}ms`,
                count: s.count
            }))
        };
    }
}

// Global benchmark instance (one per platform)
let benchmarkInstances = new Map();

export function getBenchmark(platform) {
    if (!benchmarkInstances.has(platform)) {
        const benchmark = new PerformanceBenchmark(platform);
        benchmarkInstances.set(platform, benchmark);
    }
    return benchmarkInstances.get(platform);
}

// Get all benchmark results from all platforms
export function getAllBenchmarkResults() {
    const results = {};
    for (const [platform, benchmark] of benchmarkInstances.entries()) {
        if (benchmark.isEnabled) {
            results[platform] = benchmark.getResults();
        }
    }
    return results;
}

// Clear all benchmark data
export function clearAllBenchmarks() {
    for (const benchmark of benchmarkInstances.values()) {
        benchmark.reset();
    }
}

export function enableBenchmark(platform) {
    const benchmark = getBenchmark(platform);
    benchmark.enable();
    return benchmark;
}

export function disableBenchmark(platform) {
    const benchmark = getBenchmark(platform);
    benchmark.disable();
    return benchmark;
}

export function resetBenchmark(platform) {
    const benchmark = getBenchmark(platform);
    benchmark.reset();
    return benchmark;
}

