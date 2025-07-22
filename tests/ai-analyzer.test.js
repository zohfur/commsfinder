class AIAnalyzerTests {
  constructor() {
    this.testCases = [
      { text: "Commissions are OPEN! DM me for details", expected: { commissionStatus: 'open', minConfidence: 0.7 } },
      { text: "Taking commissions now!", expected: { commissionStatus: 'open', minConfidence: 0.7 } },
      { text: "Commissions open", expected: { commissionStatus: 'open', minConfidence: 0.6 } },
      { text: "Slots available for commissions", expected: { commissionStatus: 'open', minConfidence: 0.7 } },
      { text: "Accepting commission work", expected: { commissionStatus: 'open', minConfidence: 0.7 } },
      
      // Closed cases
      { text: "Sorry, commissions are closed right now", expected: { commissionStatus: 'closed', minConfidence: 0.7 } },
      { text: "Not taking commissions at the moment", expected: { commissionStatus: 'closed', minConfidence: 0.8 } },
      { text: "Commissions closed", expected: { commissionStatus: 'closed', minConfidence: 0.7 } },
      
      // Unclear cases
      { text: "Hi! I'm an artist who loves to draw", expected: { commissionStatus: 'unclear', minConfidence: 0.3 } },
      { text: "Check out my latest artwork", expected: { commissionStatus: 'unclear', minConfidence: 0.2 } },
      { text: "Random text with no commission info", expected: { commissionStatus: 'unclear', minConfidence: 0.0 } },
      { text: "Just sharing some art", expected: { commissionStatus: 'unclear', minConfidence: 0.0 } },
      { text: "Mixed signals about commissions", expected: { commissionStatus: 'unclear', minConfidence: 0.0 } },
      { text: "Maybe taking commissions later", expected: { commissionStatus: 'unclear', minConfidence: 0.0 } },
      { text: "Thinking about opening commissions", expected: { commissionStatus: 'unclear', minConfidence: 0.0 } }
    ];
    
    this.results = [];
    this.analyzer = null;
  }
  
  async initialize() {
    try {
      // Import the analyzer module
      const module = await import('../utils/ai-analyzer.js');
      this.analyzer = module.default;
      await this.analyzer.initialize();
      console.log('✅ AI Analyzer initialized for testing');
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize AI analyzer:', error);
      return false;
    }
  }
  
  async runAllTests() {
    console.log('Commsfinder: Running tests...');
    
    if (!await this.initialize()) {
      console.error('❌ Test suite failed to initialize');
      return;
    }
    
    let passed = 0;
    let failed = 0;
    
    for (let i = 0; i < this.testCases.length; i++) {
      const testCase = this.testCases[i];
      console.log(`Test ${i + 1}/${this.testCases.length}: ${testCase.text}`);
      
      try {
        const result = await this.analyzer.analyzeText(testCase.text, 'bio');
        const success = this.validateResult(result, testCase.expected);
        
        if (success) {
          console.log(`✅ PASS - Confidence: ${Math.round(result.confidence * 100)}%, Method: ${result.method}`);
          passed++;
        } else {
          console.log(`❌ FAIL - Expected: ${testCase.expected.commissionStatus} (min ${testCase.expected.minConfidence}), Got: ${result.commissionStatus} (${Math.round(result.confidence * 100)}%)`);
          failed++;
        }
        
        this.results.push({
          testCase,
          result,
          success
        });
        
      } catch (error) {
        console.log(`❌ ERROR - ${error.message}`);
        failed++;
      }
    }
    
    this.printSummary(passed, failed);
    this.printDetailedResults();
  }
  
  validateResult(result, expected) {
    // Check if the open/closed determination is correct
    const correctStatus = result.commissionStatus === expected.commissionStatus;
    
    // Check if confidence meets minimum threshold
    const sufficientConfidence = result.confidence >= expected.minConfidence;
    
    return correctStatus && (expected.minConfidence === 0 || sufficientConfidence);
  }
  
  printSummary(passed, failed) {
    const total = passed + failed;
    const passRate = ((passed / total) * 100).toFixed(1);
    
    console.log('Commsfinder: Test summary');
    console.log(`Total Tests: ${total}`);
    console.log(`Passed: ${passed} (${passRate}%)`);
    console.log(`Failed: ${failed}`);
  }
  
  printDetailedResults() {
    console.log('📝 DETAILED RESULTS');
    console.log('===================');
    
    this.results.forEach((item, index) => {
      const { testCase, result, success } = item;
      console.log(`${index + 1}. ${testCase.text}`);
      console.log(`   Expected: ${testCase.expected.commissionStatus} (min confidence: ${testCase.expected.minConfidence})`);
      console.log(`   Got: ${result.commissionStatus} (confidence: ${Math.round(result.confidence * 100)}%)`);
      console.log(`   Result: ${success ? '✅ PASS' : '❌ FAIL'}`);
    });
  }
  
  // Run specific test by index
  async runTest(index) {
    if (index < 0 || index >= this.testCases.length) {
      console.error('Invalid test index');
      return;
    }
    
    if (!await this.initialize()) {
      console.error('Failed to initialize analyzer');
      return;
    }
    
    const testCase = this.testCases[index];
    console.log(`Running test: ${testCase.text}`);
    
    const result = await this.analyzer.analyzeText(testCase.text, 'bio');
    console.log('Result:', result);
    
    const success = this.validateResult(result, testCase.expected);
    console.log(`Test ${success ? 'PASSED' : 'FAILED'}`);
  }
  
  // Test batch processing
  async testBatchProcessing() {
    console.log('🔄 Testing batch processing...');
    
    if (!await this.initialize()) {
      console.error('Failed to initialize analyzer');
      return;
    }
    
    const texts = this.testCases.slice(0, 5).map(tc => tc.text);
    console.log(`Processing ${texts.length} texts in batch...`);
    
    const start = performance.now();
    const results = await this.analyzer.analyzeMultiple(texts, 'bio');
    const end = performance.now();
    
    console.log(`✅ Batch processing completed in ${Math.round(end - start)}ms`);
    console.log('Results:', results);
    
    // Test combined results
    const combined = this.analyzer.combineResults(results);
    console.log('Combined result:', combined);
  }
}

// Export for use in tests
if (typeof window !== 'undefined') {
  window.AIAnalyzerTests = AIAnalyzerTests;
}

// Auto-run tests if this file is loaded directly
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', async () => {
    const tests = new AIAnalyzerTests();
    
    // Uncomment to run tests automatically
    // await tests.runAllTests();
    // await tests.testBatchProcessing();
    
    // Make tests available globally for manual testing
    window.commissionTests = tests;
    console.log('Commsfinder: Tests loaded. Run `commissionTests.runAllTests()` to start testing.');
  });
} 