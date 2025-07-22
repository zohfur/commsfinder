# Commsfinder Chrome Extension

> ![Commsfinder](logos/fa.webp) **Find artists with open commissions across social media platforms**

Commsfinder is a Chrome browser extension that automatically scans your followed artists on FurAffinity, Bluesky, and Twitter/X to identify who currently has open commission slots. Using AI-powered text analysis and pattern recognition, it saves you time by eliminating the need to manually browse through hundreds (or thousands) of profiles.

## ✨ Features

- **🔍 Multi-Platform Scanning**: Supports FurAffinity, Bluesky, and Twitter/X
- **🤖 AI & No-AI Modes**: Choose between a custom-built ethical* classification model or a simple pattern recognition algorithm
- **📊 Confidence Scoring**: Each result includes a confidence percentage
- **🎯 Pattern Recognition**: Detects common obfuscation techniques (e.g., "0pen c0mms")
- **💾 Result Caching**: Saves previous scans to avoid unnecessary re-scanning
- **🔒 Privacy-First**: No data leaves your device. No telemetry, tracking, profiling, or spam
- **📋 Export Results**: Share your commission lists with friends

## 📖 How to Use

### Running a Scan

1. **Click the Commsfinder icon** in your browser toolbar
2. **Select platforms** to scan (checkboxes in the popup)
3. **Click "Scan for Open Commissions"**
4. **Wait for results** - scanning duration can vary wildly depending on how many artists you follow

### Viewing Results

- **Artist cards** show avatar, name, platform, and confidence score
- **Click any result** to open the artist's profile in a new tab
- **Sort results** by confidence level or platform
- **Filter and trim** your results by blacklisting or favoriting certain accounts
- **Share your list** to show to friends

### Understanding Confidence Scores

- **🟢 70-100%**: High confidence - Strong indicators found
- **🟡 50-69%**: Medium confidence - Likely indicators found  
- **🔴 30-49%**: Low confidence - Weak or ambiguous signals

## 🎯 What It Detects

The extension looks for commission status indicators in:

- **Artist bios/profiles**
- **Display names** (e.g., "ArtistName - COMMS OPEN")
- **Recent posts/submissions**
- **Pinned posts** (where available)

### Common Patterns Detected

✅ **Open Indicators**:

- "commissions open", "comms open"
- "accepting commissions", "taking commissions"
- "slots available", "3/5 slots open"
- "DM for commissions", "commission me"
- Obfuscated text: "0pen c0mms", "c*mms open"

❌ **Closed Indicators**:

- "commissions closed", "comms closed"
- "queue full", "not taking commissions"
- "all slots taken", "waitlist closed"

❓**Ambiguous/Unclear Indicators**:

- "DM me about comms"
- "comms: [carrd.co link]"
- "artist name - working on comms"

## ⚙️ Settings

Access settings by clicking the ⚙️ icon in the popup:

- **AI Analysis**: Enable/disable local AI processing
- **Confidence Threshold**: Minimum confidence to show results (10-100%)
- **Platform Selection**: Choose which platforms to scan
- **Data Management**: Clear cached results and settings

## 🔒 Privacy & Security

- **No data leaves your browser**: All processing is done locally
- **No API keys or developer accounts required**: Uses web scraping and service workers instead of paid APIs
- **Transparent operation**: Open source code and publicly available LLM for full transparency
- **No tracking**: The extension doesn't collect or transmit user data

### Supported Platforms

| Platform | Status | Detection Method |
|----------|--------|------------------|
| FurAffinity | ⚠️ Limited | Web scraping |
| Bluesky | ✅ Full | Atproto API |
| Twitter/X | 🚫 Unsupported | Undetermined* |

> Elon completely nuked all free API usage and blocked site access to users not signed in.
> This makes the only possible scanning method to be web scraping using an account, which is likely going to be immediately banned.
> Later down the road, if we reach enough users, I could set up a Patreon / premium subscription to fund Twitter/X support.

## 📋 Roadmap

Rough Roadmap, subject to change:
[ ] v1.1 - Polish Update: Improve UI & scan experience, bugfixing and user feedback
[ ] v1.2 - Quality of life: Scheduled scans, statistics, CSV/JSON export support
[ ] v1.3 - No-AI Mode: Regex and keyword-based detection with manual dictionary support
[ ] v1.4 - Community Verification: Users can report scan inaccuracies and submit manual artist comm status
[ ] v1.5 - Platform Update: Add support for e621, ych.commishes, Weasyl, Artistree, Artconomy, etc
[ ] v1.6 - Tag searching: Search for a specific type of art or commission
[ ] v1.7 - Android app: Android device support for mobile use
[ ] v1.8 - iOS app: Apple device support... maybe


### 🔎 Detection Strategy

Open/closed detection tries to pull as many different sources of info as possible. Very much a work in progress.

AI mode: Classifies each individual section with a local classification model. Component classifications are used alongside pattern detection to determine a confidence score.

No-AI (Regex) mode: Scan profiles using scraping and regex, manual dictionaries help improve detection. Open and closed signals across profiles contribute to a final score.

**Example:**
Artist's Profile Name: **50%**
Profile Bio: **30%**
Pinned and recent posts: **20%** *(if applicable)*
