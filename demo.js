// Wait for DOM to be fully loaded
document.addEventListener('DOMContentLoaded', () => {
    // Check if we're running in extension context
    const isExtensionContext = window.location.protocol === 'chrome-extension:';
    
    // Hide extension ID input if we're in extension context
    const extensionIdSection = document.getElementById('extension-id-section');
    if (extensionIdSection) {
        extensionIdSection.style.display = isExtensionContext ? 'none' : 'block';
    }

    // Get or set extension ID from localStorage (only needed for external context)
    let extensionId = isExtensionContext ? null : localStorage.getItem('commsfinder-extension-id');
    if (!isExtensionContext && extensionId) {
        document.getElementById('extensionId').value = extensionId;
        document.getElementById('extension-status').textContent = 'Extension ID loaded from storage';
    }

    // Save Extension ID button
    const saveIdButton = document.getElementById('saveIdButton');
    if (saveIdButton) {
        saveIdButton.addEventListener('click', () => {
            const input = document.getElementById('extensionId');
            extensionId = input.value.trim();
            localStorage.setItem('commsfinder-extension-id', extensionId);
            document.getElementById('extension-status').textContent = 'Extension ID saved!';
        });
    }

    // Helper function to send messages
    async function sendMessage(message) {
        if (isExtensionContext) {
            // We're in the extension context, use chrome.runtime directly
            return new Promise((resolve, reject) => {
                chrome.runtime.sendMessage(message, response => {
                    if (chrome.runtime.lastError) {
                        reject(chrome.runtime.lastError);
                    } else {
                        resolve(response);
                    }
                });
            });
        } else {
            // We're in external context, need extension ID
            if (!extensionId) {
                throw new Error('Please enter your extension ID first!');
            }
            return new Promise((resolve, reject) => {
                chrome.runtime.sendMessage(extensionId, message, response => {
                    if (chrome.runtime.lastError) {
                        reject(chrome.runtime.lastError);
                    } else {
                        resolve(response);
                    }
                });
            });
        }
    }

    // Analyze Text button
    document.getElementById('analyzeButton').addEventListener('click', async () => {
        const text = document.getElementById('testText').value;
        const resultDiv = document.getElementById('analyzeResult');
        resultDiv.innerHTML = '<div class="status loading">Analyzing text...</div>';
        
        try {
            const response = await sendMessage({
                type: 'analyze_text',
                text: text,
                context: 'bio'
            });

            if (response.success) {
                const result = response.result;
                const confidencePercent = Math.round(result.confidence * 100);
                const confidenceClass = confidencePercent >= 70 ? 'high' : 
                                      confidencePercent >= 50 ? 'medium' : 'low';
                
                // Determine status display based on commissionStatus field
                let statusIcon, statusText;
                if (result.commissionStatus === 'open') {
                    statusIcon = '✅';
                    statusText = 'Open';
                } else if (result.commissionStatus === 'closed') {
                    statusIcon = '❌';
                    statusText = 'Closed';
                } else {
                    statusIcon = '❓';
                    statusText = 'Unclear';
                }
                
                resultDiv.innerHTML = `
                    <div class="result confidence-${confidenceClass}">
                        <strong>Result:</strong> ${statusIcon} ${statusText} commissions<br>
                        <strong>Confidence:</strong> ${confidencePercent}%<br>
                        <strong>Method:</strong> ${result.method}<br>
                        ${result.triggers && result.triggers.length > 0 ? 
                          `<strong>Triggers:</strong> ${result.triggers.join(', ')}<br>` : ''}
                        ${result.allResults ? 
                          `<details><summary>Debug Info</summary><pre>${JSON.stringify(result.allResults, null, 2)}</pre></details>` : ''}
                    </div>
                `;
            } else {
                resultDiv.innerHTML = `<div class="status error">Error: ${response.error}</div>`;
            }
        } catch (error) {
            resultDiv.innerHTML = `
                <div class="status error">
                    Error: ${error.message}<br>
                    ${!isExtensionContext ? 'Make sure the extension is installed and the ID is correct.' : ''}
                </div>
            `;
        }
    });

    // Run Tests button
    document.getElementById('testButton').addEventListener('click', async () => {
        const resultDiv = document.getElementById('analyzeResult');
        resultDiv.innerHTML = '<div class="status loading">Running tests...</div>';
        
        try {
            const response = await sendMessage({
                type: 'runTests'
            });

            if (response.success) {
                const results = response.results;
                const summary = response.summary;
                
                let html = `<h3>Test Results (${summary.passed}/${summary.total} passed):</h3>`;
                
                results.forEach(result => {
                    const statusClass = result.passed ? 'passed' : 'failed';
                    html += `
                        <div class="test-result ${statusClass}">
                            <strong>Test:</strong> "${result.text}"<br>
                            <strong>Expected:</strong> ${result.expected ? 'Open' : 'Closed'}<br>
                            <strong>Actual:</strong> ${result.actual ? 'Open' : 'Closed'}<br>
                            <strong>Confidence:</strong> ${Math.round(result.confidence * 100)}%<br>
                            <strong>Status:</strong> ${result.passed ? 'PASSED' : 'FAILED'}
                        </div>
                    `;
                });
                
                resultDiv.innerHTML = html;
            } else {
                resultDiv.innerHTML = `<div class="status error">Error running tests: ${response.error}</div>`;
            }
        } catch (error) {
            resultDiv.innerHTML = `<div class="status error">Error: ${error.message}</div>`;
        }
    });

    // Example text clicks
    document.querySelectorAll('.example-text').forEach(example => {
        example.addEventListener('click', () => {
            const text = example.dataset.text;
            document.getElementById('testText').value = text;
            document.getElementById('analyzeButton').click();
        });
    });

    // Enable debug mode
    localStorage.setItem('commsfinder-debug', 'true');

    // If we're in extension context, set the extension ID as a data attribute
    if (isExtensionContext) {
        document.documentElement.setAttribute('data-extension-id', chrome.runtime.id);
    }
}); 