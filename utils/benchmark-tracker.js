// Benchmark tracking for scan performance measurement.
// Manages benchmark runs, per-platform results, and summary generation.

/** @type {object} Per-platform benchmark results in memory. */
let benchmarkResults = {};

/**
 * Handle incoming benchmark results from a platform scan.
 */
export async function handleBenchmarkResults(platform, results) {
  console.log(`[Background] Received benchmark results for ${platform}:`, results);
  benchmarkResults[platform] = results;

  await chrome.storage.local.set({ benchmarkResults });

  chrome.runtime.sendMessage({
    type: 'BENCHMARK_RESULTS_UPDATE',
    platform: platform,
    results: results
  }).catch(() => {});
}

/**
 * Finalize a benchmark run — persist the summary and notify the popup.
 * @param {'completed'|'completed_with_errors'|'failed'} status
 * @param {Array} finalResults
 * @param {string|null} error
 * @returns {Promise<object|null>} The lastBenchmarkRun summary, or null if no active run.
 */
export async function finishBenchmarkRun(status, finalResults = [], error = null) {
  const stored = await chrome.storage.local.get(['activeBenchmarkRun', 'benchmarkResults']);
  const activeBenchmarkRun = stored.activeBenchmarkRun;
  if (!activeBenchmarkRun) return null;

  const finishedAt = Date.now();
  const perPlatformResults = stored.benchmarkResults || benchmarkResults || {};
  const lastBenchmarkRun = {
    ...activeBenchmarkRun,
    status,
    error,
    finishedAt,
    wallClockMs: finishedAt - activeBenchmarkRun.startedAt,
    wallClockSeconds: (finishedAt - activeBenchmarkRun.startedAt) / 1000,
    resultCount: Array.isArray(finalResults) ? finalResults.length : 0,
    benchmarkResults: perPlatformResults,
    platformSummaries: Object.fromEntries(
      Object.entries(perPlatformResults).map(([platform, result]) => [
        platform,
        {
          profileCount: result?.profileCount || 0,
          totalTimeMs: result?.totalTimeMs || 0,
          totalTimeSeconds: result?.totalTimeSeconds || 0,
          topSteps: Array.isArray(result?.steps) ? result.steps.slice(0, 8) : [],
        },
      ])
    ),
  };

  await chrome.storage.local.remove(['activeBenchmarkRun']);
  await chrome.storage.local.set({ lastBenchmarkRun });

  chrome.runtime.sendMessage({
    type: 'BENCHMARK_SCAN_FINISHED',
    data: lastBenchmarkRun,
  }).catch(() => {});

  return lastBenchmarkRun;
}

/**
 * Retrieve stored benchmark results.
 */
export async function getStoredBenchmarkResults(sendResponse) {
  try {
    const stored = await chrome.storage.local.get(['benchmarkResults', 'lastBenchmarkRun']);
    sendResponse({
      success: true,
      results: stored.benchmarkResults || benchmarkResults,
      run: stored.lastBenchmarkRun || null
    });
  } catch (error) {
    console.error('Error getting benchmark results:', error);
    sendResponse({
      success: false,
      error: error.message,
      results: benchmarkResults
    });
  }
}

/**
 * Retrieve the stored benchmark run (completed or active).
 */
export async function getStoredBenchmarkRun(sendResponse) {
  try {
    const stored = await chrome.storage.local.get(['lastBenchmarkRun', 'activeBenchmarkRun']);
    sendResponse({
      success: true,
      run: stored.lastBenchmarkRun || null,
      activeRun: stored.activeBenchmarkRun || null,
    });
  } catch (error) {
    console.error('Error getting benchmark run:', error);
    sendResponse({ success: false, error: error.message });
  }
}

/**
 * Access the in-memory benchmark results (for merging with storage).
 */
export function getBenchmarkResults() {
  return benchmarkResults;
}

/**
 * Clear the in-memory benchmark results.
 */
export function clearBenchmarkResults() {
  benchmarkResults = {};
}
