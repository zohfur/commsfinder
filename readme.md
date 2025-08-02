
# 🔍 Commsfinder Extension

![Commsfinder](logos/commsfinder_outline.png) **Find artists to commission across multiple platforms**

Commsfinder is a cross-platform browser extension that automatically scans your followed artists on FurAffinity, Bluesky, Twitter/X, and more, to identify artists that are currently open for commissions or paid work. Using AI-powered text analysis and pattern recognition, it saves you time by eliminating the need to manually browse through hundreds (or thousands) of profiles.

Commsfinder uses a custom fine-tuned classification model based on DistilBERT that runs entirely in your web browser off pure JavaScript; no programs, APIs, servers, or paid software required. It supports both CPU and GPU inference through Onnxruntime-web (ORT).

## ✨ Features

- **Multi-Platform Scanning:** Support FurAffinity and Bluesky with more to come.

- **AI & No-AI Modes**: Choose between Commsfinder's classification model or simple pattern detection using regex and keywords.

- **Sorted by confidence**: Each classification outputs a confidence score which is totalled to a final result per profile; the resulting list is sorted by confidence, showing the most likely available artists at the top.

- **Result caching**: Saves previous scans and partial scan progress to a local cache to avoid unnecessary waiting and page loads.

- **Damn good privacy**: No data leaves your device. No telemetry, servers, or spam.

## 📖 How to Use

### Running a Scan

1. **Click the Commsfinder icon** in your browser toolbar
2. **Select platforms** to scan (checkboxes in the popup)
3. **Click "Scan for Open Commissions"**
4. **Wait for results** - scanning duration can vary wildly depending on how many artists you follow

### Viewing Results

- **Artist cards** show the avatar, name, platform, and confidence score
- **Click any result** to open the artist's profile in a new tab
- **Filter results** by confidence level or platform
- **Personalize** your results by blacklisting or favoriting certain accounts

### Understanding Artist Scores

- **🟢 70-100%**: High confidence artist is open
- **🟡 50-69%**: Some results classified as open
- **🔴 30-49%**: Likely not accepting commissions

**Why is a certain profile wrongly detected as closed?**
> If an artist does not specifically mention they are open or closed, we have no way of detecting that aside from asking them directly.
> In the future, support will be added for the community to manually submit corrections or share openings.

## Detection

Commsfinder tries to pull from as many sources as possible while being mindful of the sites we're utilizing.

### Example: FurAffinity

We search the user's Favorites and Watchlist pages to find artists.

Each artist is scraped for the following data points:

1. **Profile Bio** and description
2. **Recent gallery items** (and their names, description, and tags)
3. **Pinned/most recent journal** (we also weigh this by how recent it is)
4. **Profile commissions status** (Commissions: Yes/No)

Each component is classified and the final score is calculated by weighing all the available data.

## 🎨 Supported Platforms

| Platform | Status | Detection Method |
|----------|--------|------------------|
| FurAffinity | ⚠️ Limited | Web scraping |
| Bluesky | ✅ Full | Atproto API |
| Twitter/X | 🚫 Unsupported | Undetermined* |

> Elon completely nuked all free API usage and blocked site access to users not signed in.
> This makes the only possible scanning method to be web scraping using an account, which is likely going to be immediately banned.
> Later down the road, if we reach enough users, I could set up a Patreon / premium subscription to fund Twitter/X support.

## 🔒 Privacy and Security

**No data leaves your browser:** All processing and inference is done locally

**No API keys or developer accounts required:** Uses web scraping and JS service workers instead of paid APIs

**Transparency**: Open source code and publicly available DistilBERT model

**No telemetry or tracking**: No user data collected or transmitted

## 🗺️ Roadmap

*Rough roadmap, very subject to change*

### v1.1 - Polish Update

- Improve UI and scan experience
- Bugfixing
- Implement user requests and feedback

### v1.2 - Quality of Life

- Scan statistics
- CSV/JSON export support
- Improve No-AI mode accuracy

### v1.3 - Model Update

- New revision of classification Model
- Higher accuracy and faster inference
- Better WebGPU support

### v1.4 - Community Update

- Users can report scan inaccuracies
- Manually submit artist status
- Buyer Beware / Artist Beware integration(?)

### v1.5 - Platform Update

- Add support for e621, ych.commishes, Weasyl, Artistree, Artconomy
- Re-evaluate Twitter/X support (if we reach enough users)

### v1.6+ - Tagging and Mobile Development

- Tag searching: Search for artists with specific keyword or tag
- Android app for mobile usage
- iOS app.. maybe.
