<a id="readme-top"></a>

[![License][license-badge]][license]
[![Open Issues][issues-badge]][issues]
[![Chrome Web Store Users][chrome-badge]][chrome]
[![Firefox Add-ons Users][firefox-badge]][firefox]
[![Manifest V3][mv3-badge]](#)

***

<h1 align="center">
<sub><img src="logos/commsfinder_outline.png" height="38" width="38"></sub>
Commsfinder
</h1>

<p align="center"><strong>Find artists with open commissions across multiple platforms, scanned locally in your browser.</strong></p>

<p align="center">
<a href="#installation">Install</a> &nbsp;·&nbsp;
<a href="#usage">Usage</a> &nbsp;·&nbsp;
<a href="https://github.com/zohfur/commsfinder/issues/new?template=bug_report.md">Report a Bug</a> &nbsp;·&nbsp;
<a href="https://github.com/zohfur/commsfinder/issues/new">Request a Feature</a>
</p>

[license]: LICENSE
[issues]: https://github.com/zohfur/commsfinder/issues
[chrome]: https://chromewebstore.google.com/detail/eieceiemgcadopdfhbggibicepnkmako
[firefox]: https://addons.mozilla.org/en-US/firefox/addon/commsfinder/

[license-badge]: https://img.shields.io/badge/license-AGPL--3.0-blue
[issues-badge]: https://img.shields.io/github/issues/zohfur/commsfinder
[chrome-badge]: https://img.shields.io/chrome-web-store/users/eieceiemgcadopdfhbggibicepnkmako?label=chrome%20users&logo=googlechrome&logoColor=white
[firefox-badge]: https://img.shields.io/amo/users/commsfinder?label=firefox%20users&logo=firefoxbrowser&logoColor=white
[mv3-badge]: https://img.shields.io/badge/manifest-v3-success

---

<a id="about"></a>

## /•᷅‎‎•᷄\੭ About

you probably: *"what if there was a way to tell which artists on my social media were open for comms??"*
>ok but what if i was thinking the same thing and then made that thing

Commsfinder is a cross-platform browser extension that scans the artists you already follow on [FurAffinity](https://www.furaffinity.net), [Bluesky](https://bsky.app), and more, then flags which ones are currently **open for commissions**. Instead of manually crawling hundreds (or thousands) of profiles, you run one scan and get a neat sorted list.

Classification runs on a custom fine-tuned [DistilBERT](https://huggingface.co/docs/transformers/model_doc/distilbert) model that executes **entirely in your browser** using pure JavaScript; no native programs, external APIs, servers, or paid software. Inference runs on CPU or WebGPU through [ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/) (ORT) via [Transformers.js](https://github.com/huggingface/transformers.js).

Yes, it uses a large language model; for an actually good reason. This entire project grew to be a hopeful lesson in actual ethical use of LLMs (and... *yucky AI..*) Commsfinder uses **discriminative** AI, the image-and-pattern-recognition kind. No art is being generated or trained on, no data to be harvested and sold. It's a tool that does its job and __that's it.__



---

<a id="features"></a>

## (っ˘ڡ˘ς)   mmm yummy features

- **Multi-platform scanning**: FurAffinity and Bluesky today, with more on the [roadmap](#roadmap).
- **AI & No-AI modes**: Choose the fine-tuned classification model, or fall back to lightweight pattern detection using regex and keywords.
- **Confidence ranking**: Every data point is scored and combined into a per-profile confidence score; results are sorted so the most likely available artists surface first.
- **Result caching**: Completed scans and partial progress are cached locally to avoid redundant page loads and waiting.
- **Privacy by design**: No data leaves your device. No telemetry or servers.

---

<a id="supported-platforms"></a>

## ✎ᝰ   Supported Platforms

| Platform | Status | Detection Method |
| :--- | :--- | :--- |
| <img src="logos/fa.webp" width="16" align="absmiddle"> [FurAffinity](https://www.furaffinity.net) | ⚠️ Limited | Web scraping |
| <img src="logos/bsky.svg" width="16" align="absmiddle"> [Bluesky](https://bsky.app) | ✅ Full | [AT Protocol](https://atproto.com) API |
| <img src="logos/twitter.svg" width="16" align="absmiddle"> [Twitter / X](https://x.com) | 🚫 Unsupported | Undetermined* |

> \* Elon removed all free API access and blocked site access for signed-out users. The only remaining scanning method is logged-in web scraping. This doesn't really work anymore either as they have severely ratelimited users, and have gone to lengths to even ban some automated accounts. If the project reaches enough users, a Patreon / premium tier could fund proper X API support down the road.

---

<a id="installation"></a>

## Installation  (╭ರ_•́)

| Browser | Get it |
| :--- | :--- |
| <img src="logos/chrome.svg" width="20" align="absmiddle"> **Chrome** and anything Chromium: Edge, Brave, Opera, etc | [Chrome Web Store](https://chromewebstore.google.com/detail/eieceiemgcadopdfhbggibicepnkmako) |
| <img src="logos/firefox.svg" width="20" align="absmiddle"> **Firefox** (≥ 121) | [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/commsfinder/) |
| <img src="logos/safari.svg" width="20" align="absmiddle"> **Safari** | no. |

Or visit [findcom.ms](https://findcom.ms) for direct install links.

### Build from source

**Prerequisites:** [Node.js](https://nodejs.org) ≥ 21 (built with Node 24.4.1 / npm 11.5.1).

```bash
git clone https://github.com/zohfur/commsfinder.git
cd commsfinder
npm install
npm run build:both        # or build:chrome / build:firefox
```

Packaged builds land in `dist/chrome/` and `dist/firefox/` (a versioned `.zip` is produced for each).

**Load the unpacked extension:**

- **Chrome / Chromium:** go to `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select `dist/chrome/`.
- **Firefox:** go to `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on**, and select the manifest inside `dist/firefox/`. You may need to specifically use Firefox Developer Edition; that's what I had to use for testing to get everything to work as expected, especially hot-reloading.


---

<a id="usage"></a>

## ₍^. .^₎⟆    Usage

### Running a scan

1. **Click the Commsfinder icon** in your browser toolbar.
2. **Select platforms** to scan (checkboxes in the popup).
3. **Click "Scan for Open Commissions."**
4. **Wait for results**: scan duration varies widely with how many artists you follow.

### Viewing results

- **Artist cards** show avatar, name, platform, and confidence score.
- **Click any result** to open the artist's profile in a new tab.
- **Filter** results by confidence level or platform.
- **Personalize** by favoriting or blacklisting accounts.

### Reading confidence scores

| Score | Meaning |
| :--- | :--- |
| 🟢 **70–100%** | High confidence the artist is open |
| 🟡 **50–69%** | Some signals classified as open |
| 🔴 **30–49%** | Likely not accepting commissions |

> **Why is a profile showing open/closed when it shouldn't?**  
If an artist never states whether they're open or closed, there's no signal to detect short of asking them directly.  
A future release will let the community submit corrections and share openings manually.   Ask your artist friends to put their status in their bios or pinned posts!! (please.)

---

<a id="how-detection-works"></a>

## How Detection Works   ه = ∑∞ⁿ⁼⁰ ¹ₙ

Commsfinder pulls from as many sources as a platform reasonably exposes, and tries to be mindful of ratelimiting and usage restrictions.

### Example: FurAffinity

Artists are discovered from the user's **Favorites** and **Watchlist** pages. Each artist is then scraped for:

1. **Profile bio** and description
2. **Recent gallery items**: names, descriptions, and tags
3. **Pinned / most recent journal**: weighted by recency
4. **Profile commission status**: `Commissions: Yes/No`

Each component is classified independently, and the final score is a weighted combination of all available data.

---

<a id="built-with"></a>

## </>   Built With

- [DistilBERT](https://huggingface.co/docs/transformers/model_doc/distilbert) ([paper](https://arxiv.org/abs/1910.01108)): base architecture for the classifier
- [Transformers.js](https://github.com/huggingface/transformers.js) (`@xenova/transformers`): in-browser inference pipeline
- [ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/): CPU & WebGPU inference backend
- [Webpack](https://webpack.js.org): build tooling
- [AT Protocol](https://atproto.com): Bluesky data source

---

<a id="privacy--security"></a>

## Privacy & Security (⌐■_■)

- **No data leaves your browser**: all processing and inference is local.
- **No API keys or developer accounts**: runs on web scraping and JS service workers.
- **Transparent**: [open source code](https://github.com/zohfur/commsfinder) and a [public model](https://huggingface.co/zohfur/distilbert-commissions).
- **No telemetry or tracking**: no user data collected or transmitted.

See the full [Privacy Policy](privacy-policy.md) for details.

---

<a id="roadmap"></a>

## /ᐠ≽•ヮ•≼マ Roadmap 
> Rough and very subject to change!!  
I work on this project randomly when the motivation gloops between all the creases in my wrinkly brain  

**v1.1.1: Current release**

- Popup UI and scan-experience polish pass
 - Accessibility and interaction improvements (touch targets, structure, status messaging)
 - Styling consistency and animation cleanup

**v1.2: Quality of life**

 - Scan statistics
 - CSV / JSON export
 - Improved "No-AI mode" accuracy

**v1.3: Model update**

 - New classification model revision
 - Higher accuracy and faster inference
 - Better WebGPU support

**v1.4: Community update**

 - Scan inaccuracy reporting
 - Manual artist status submissions
 - Buyer Beware / Artist Beware integration (maybe?)

**v1.5: Platform update**

 - Add ych.commishes, [Weasyl](https://www.weasyl.com), Artistree, Artconomy, Sofurry
 - Re-evaluate Twitter / X support

**v1.6+: Tagging & mobile**

 - Tag search: find artists by keyword or tag
 - Android app
 - iOS app… maybe.

See [open issues](https://github.com/zohfur/commsfinder/issues) for the full list of proposed features and known bugs.


---

<a id="contributing"></a>

##  Contributing ⸜(｡˃ ᵕ ˂ )⸝♡

The code is a nightmare and anything I make is held together by stickers and Elmer's glue. That said, if you want to contribute a feature or bug fix, I would appreciate it! Fork, branch, and open a PR.

Found a bug or have an idea? [Please open an issue!](https://github.com/zohfur/commsfinder/issues)


---

<a id="license"></a>

## -ˋˏ✄┈┈┈┈   License

Distributed under the **AGPL-3.0** License. See [`LICENSE`](LICENSE) for details.


---

<a id="contact"></a>

## Contact    ˗ˏˋ ꒰ ✉︎ ꒱ ˎˊ˗ 

**Zohfur**: commsfinder@zohfur.dog

Project link: [https://github.com/zohfur/commsfinder](https://github.com/zohfur/commsfinder)
