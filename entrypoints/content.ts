import { defineContentScript } from "wxt/sandbox";
import { storage } from "wxt/storage";

// Types
interface LinkState {
  url: string;
  status: "pending" | "fetching" | "done" | "error";
  context?: string;
  screenshot?: string;
}

interface Highlight {
  id: string;
  text: string;
  range: Range;
  state: LinkState;
}

// Constants
const SELECTORS = {
  INPUT: ".ProseMirror",
  SUBMIT_BUTTON: "button[aria-label='Send Message']",
  OVERLAY_ID: "linksnap-overlay",
  LOADING_ID: "linksnap-loading",
  STYLES_ID: "linksnap-styles",
} as const;

const URL_REGEX = /@link\s+(https?:\/\/[^\s]+)/g;

class LinkSnapProcessor {
  private readonly observer: MutationObserver;
  private readonly highlights: Map<string, Highlight> = new Map();
  private readonly pendingLinks: Set<string> = new Set();
  private readonly contextCache =
    storage.defineItem<Record<string, LinkState>>("local:contextCache");

  private highlightOverlay: HTMLElement | null = null;
  private isSubmitting = false;
  private readonly DEBUG = true;

  constructor() {
    this.observer = new MutationObserver(this.handleMutation.bind(this));
  }

  private log(...args: unknown[]): void {
    if (this.DEBUG) {
      console.log("[LinkSnap]", ...args);
    }
  }

  public init(): void {
    this.log("Initializing LinkSnap");
    this.setupUI();
    this.setupEventListeners();
  }

  private setupUI(): void {
    this.setupOverlay();
    this.injectStyles();
    this.setupLoadingIndicator();
  }

  private setupEventListeners(): void {
    this.setupObserver();
    this.setupKeyListeners();
    this.setupKeyInterception();
    this.setupButtonInterception();
  }

  private setupOverlay(): void {
    const existingOverlay = document.getElementById(SELECTORS.OVERLAY_ID);
    if (existingOverlay) {
      existingOverlay.remove();
    }

    this.highlightOverlay = document.createElement("div");
    this.highlightOverlay.id = SELECTORS.OVERLAY_ID;
    document.body.appendChild(this.highlightOverlay);
  }

  private setupObserver(): void {
    const config: MutationObserverInit = {
      childList: true,
      subtree: true,
      characterData: true,
    };

    const bodyObserver = new MutationObserver((_, observer) => {
      const inputDiv = document.querySelector(SELECTORS.INPUT);
      if (inputDiv) {
        this.observer.observe(inputDiv, config);
        this.updateHighlights();
        observer.disconnect();
      }
    });

    bodyObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });

    const inputDiv = document.querySelector(SELECTORS.INPUT);
    if (inputDiv) {
      this.observer.observe(inputDiv, config);
      this.updateHighlights();
    }
  }

  private setupKeyListeners(): void {
    document.addEventListener("keydown", (event) => {
      if (event.key === " " || event.key === "Enter") {
        this.processPendingLinks();
      }
    });
  }

  private isProcessing = false;
  private shouldBypassInterception = false;

  private setupKeyInterception(): void {
    window.addEventListener(
      "keydown",
      (event: KeyboardEvent) => {
        if (this.shouldBypassInterception) return;
        if (event.key === "Enter" && !event.shiftKey) {
          const activeElement = document.activeElement;
          const inputDiv = document.querySelector(SELECTORS.INPUT);

          if (
            activeElement &&
            (activeElement === inputDiv ||
              (inputDiv && inputDiv.contains(activeElement)))
          ) {
            this.log("Enter key intercepted");
            event.preventDefault();
            event.stopPropagation();
            void this.handleSubmitAttempt("enter");
          }
        }
      },
      true
    );
  }

  private setupButtonInterception(): void {
    document.addEventListener(
      "click",
      (event: MouseEvent) => {
        if (this.shouldBypassInterception) return;
        const target = event.target as HTMLElement;
        const submitButton = target.closest(SELECTORS.SUBMIT_BUTTON);

        if (submitButton) {
          this.log("Submit button click intercepted");
          event.preventDefault();
          event.stopPropagation();
          void this.handleSubmitAttempt("click");
        }
      },
      true
    );
  }

  private handleMutation = debounce(() => {
    this.updateHighlights();
  }, 100);

  private async updateHighlights(): Promise<void> {
    const inputDiv = document.querySelector(SELECTORS.INPUT);
    if (!inputDiv || !this.highlightOverlay) return;

    const text = inputDiv.textContent || "";
    const matches = Array.from(text.matchAll(URL_REGEX));
    const currentIds = new Set<string>();

    for (const match of matches) {
      const id = generateId(match[0]);
      currentIds.add(id);

      if (!this.highlights.has(id)) {
        const range = findRangeForMatch(inputDiv, match[0]);
        if (range) {
          this.highlights.set(id, {
            id,
            text: match[0],
            range,
            state: { url: match[1], status: "pending" },
          });
          this.pendingLinks.add(match[1]);
        }
      }
    }

    for (const [id, highlight] of this.highlights.entries()) {
      if (!currentIds.has(id)) {
        this.highlights.delete(id);
        this.pendingLinks.delete(highlight.state.url);
      }
    }

    this.renderHighlights();
  }

  private async processPendingLinks(): Promise<void> {
    const processPromises = Array.from(this.pendingLinks).map(async (url) => {
      const id = generateId(`@link ${url}`);
      const highlight = this.highlights.get(id);
      if (highlight?.state.status === "pending") {
        highlight.state.status = "fetching";
        this.renderHighlights();
        await this.processLink(id, url);
      }
    });

    await Promise.all(processPromises);
    this.pendingLinks.clear();
  }

  private async processLink(id: string, url: string): Promise<void> {
    const cache = (await this.contextCache.getValue()) ?? {};
    if (cache[url]) {
      this.updateHighlightState(id, cache[url]);
      return;
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await this.fetchLinkContext(url);

        if (response.success && response.data) {
          const newState: LinkState = {
            url,
            status: "done",
            context: response.data.markdown,
            metadata: response.data.metadata,
          };

          
          if (response.data.originalData?.screenshot) {
            newState.screenshot = response.data.originalData.screenshot;
          }

          cache[url] = newState;
          this.updateHighlightState(id, newState);
          await this.contextCache.setValue(cache);
          return;
        }

        throw new Error(response.data?.metadata?.error || "Unknown error");
      } catch (error) {
        console.error(`Attempt ${attempt + 1} failed for URL: ${url}`, error);

        if (attempt === 2) {
          const errorState: LinkState = {
            url,
            status: "error",
            error: error.message,
          };
          cache[url] = errorState;
          this.updateHighlightState(id, errorState);
          await this.contextCache.setValue(cache);
        } else {
          await delay(1000 * (attempt + 1));
        }
      }
    }
  }

  private async fetchLinkContext(url: string): Promise<any> {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          action: "fetchContext",
          url,
        },
        resolve
      );
    });
  }

  private updateHighlightState(id: string, state: LinkState): void {
    const highlight = this.highlights.get(id);
    if (highlight) {
      highlight.state = state;
      this.renderHighlights();
    }
  }

  private renderHighlights(): void {
    if (!this.highlightOverlay) return;

    this.highlightOverlay.innerHTML = "";

    for (const highlight of this.highlights.values()) {
      const rect = highlight.range.getBoundingClientRect();
      const highlightElement = document.createElement("div");
      highlightElement.className = `linksnap-highlight linksnap-${highlight.state.status}`;

      Object.assign(highlightElement.style, {
        position: "absolute",
        left: `${rect.left + window.scrollX}px`,
        top: `${rect.top + window.scrollY}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        pointerEvents: "none",
      });

      const tooltip = document.createElement("div");
      tooltip.className = "linksnap-tooltip";
      tooltip.textContent = this.getTooltipText(highlight.state);
      highlightElement.appendChild(tooltip);

      this.highlightOverlay.appendChild(highlightElement);
    }
  }

  private getTooltipText(state: LinkState): string {
    switch (state.status) {
      case "pending":
        return "Waiting for you to finish typing...";
      case "fetching":
        return "Fetching context...";
      case "done":
        return "Context available";
      case "error":
        return "Failed to fetch context";
      default:
        return "";
    }
  }

  private async handleSubmitAttempt(
    triggerType: "click" | "enter"
  ): Promise<void> {
    if (this.isProcessing) {
      this.log("Already processing, ignoring");
      return;
    }

    this.log("Starting submission process");
    this.isProcessing = true;

    try {
      await this.showLoadingIndicator();
      await this.processPendingLinks();
      const wasInjected = await this.injectContext();

      this.log("Context injection result:", wasInjected);

      
      this.shouldBypassInterception = true;

      
      this.triggerNativeSubmission(triggerType);

      
      await delay(1000);
    } catch (error) {
      console.error("Error during submission:", error);
      this.showErrorMessage(
        "An error occurred while processing your submission."
      );
    } finally {
      this.hideLoadingIndicator();
      this.isProcessing = false;
      this.shouldBypassInterception = false;
    }
  }

  private triggerNativeSubmission(triggerType: "click" | "enter"): void {
    const submitButton = document.querySelector(
      SELECTORS.SUBMIT_BUTTON
    ) as HTMLButtonElement;

    if (!submitButton) {
      console.error("Submit button not found");
      return;
    }

    if (triggerType === "enter") {
      const inputDiv = document.querySelector(SELECTORS.INPUT);
      if (inputDiv) {
        inputDiv.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            code: "Enter",
            which: 13,
            keyCode: 13,
            bubbles: true,
            cancelable: true,
          })
        );
      }
    } else {
      submitButton.click();
    }
  }

  private async pasteImageFromUrl(
    url: string,
    inputDiv: HTMLElement
  ): Promise<void> {
    try {
      console.log("Fetching image...");
      const response = await fetch(url);
      const blob = await response.blob();

      const file = new File([blob], "image.png", { type: blob.type });

      const fileInput = inputDiv.querySelector(
        'input[type="file"][data-testid="file-upload"]'
      ) as HTMLInputElement;

      if (fileInput) {
        
        const uploadPromise = new Promise<void>((resolve, reject) => {
          const observer = new MutationObserver((mutations, obs) => {
            for (const mutation of mutations) {
              if (mutation.type === "childList") {
                
                const previewImage = inputDiv.querySelector(
                  'img[data-testid="preview-image"]'
                );
                if (previewImage) {
                  obs.disconnect();
                  resolve();
                  return;
                }
              }
            }
          });

          observer.observe(inputDiv, {
            childList: true,
            subtree: true,
            attributes: true,
          });

          
          const timeout = setTimeout(() => {
            observer.disconnect();
            resolve();
          }, 5000);

          
          const dataTransfer = new DataTransfer();
          dataTransfer.items.add(file);
          fileInput.files = dataTransfer.files;
          const event = new Event("change", { bubbles: true });
          fileInput.dispatchEvent(event);
        });

        
        await uploadPromise;
        console.log("Image upload completed");
      }
    } catch (error) {
      console.error("Error uploading image:", error);
      const screenshotP = document.createElement("p");
      screenshotP.textContent = `\n\n![Screenshot](${url})`;
      inputDiv.appendChild(screenshotP);
    }
  }

  protected async injectContext(): Promise<boolean> {
    const inputDiv = document.querySelector(SELECTORS.INPUT) as HTMLElement;
    if (!inputDiv) return false;

    let injectedAny = false;
    const content = inputDiv.textContent || "";

    for (const highlight of this.highlights.values()) {
      const linkText = `@link ${highlight.state.url}`;

      if (
        highlight.state.status === "done" &&
        highlight.state.context &&
        content.includes(linkText)
      ) {
        try {
          let contextText = `\n\nContext for ${highlight.state.url}:\n${highlight.state.context}`;
          console.log("contextText: ", contextText)
          if (highlight.state.metadata) {
            const { title, description } = highlight.state.metadata;
            if (title && title !== description) {
              contextText = `\n\n# ${title}\n\n${contextText}`;
            }
          }

          const p = document.createElement("p");
          p.textContent = contextText;
          // p.className = "linksnap-hidden";
          

          inputDiv.appendChild(p);

          if (highlight.state.screenshot) {
            try {
              let outerDiv = document.querySelector("body") as HTMLElement;
              await this.pasteImageFromUrl(
                highlight.state.screenshot,
                outerDiv
              );
            } catch (error) {
              console.error("Failed to paste image:", error);
            }
          }

          injectedAny = true;
        } catch (error) {
          console.error("Error injecting context:", error);
        }
      }
    }

    return injectedAny;
  }

  private setupLoadingIndicator(): void {
    const indicator = document.createElement("div");
    indicator.id = SELECTORS.LOADING_ID;
    indicator.innerHTML = `
      <div class="linksnap-spinner"></div>
      <div class="linksnap-loading-text">Processing links...</div>
    `;
    document.body.appendChild(indicator);
  }

  private showLoadingIndicator(): void {
    const indicator = document.getElementById(SELECTORS.LOADING_ID);
    if (indicator) indicator.style.display = "flex";
  }

  private hideLoadingIndicator(): void {
    const indicator = document.getElementById(SELECTORS.LOADING_ID);
    if (indicator) indicator.style.display = "none";
  }

  private showErrorMessage(message: string): void {
    console.error(message);
  }

  private injectStyles(): void {
    if (document.getElementById(SELECTORS.STYLES_ID)) return;

    const styles = document.createElement("style");
    styles.id = SELECTORS.STYLES_ID;
    styles.textContent = `
      #${SELECTORS.OVERLAY_ID} {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        pointer-events: none;
        z-index: 10000;
      }
      .linksnap-highlight {
        border-radius: 4px;
        transition: all 0.3s ease;
        cursor: help;
      }
      .linksnap-pending {
        background-color: rgba(156, 163, 175, 0.1);
        border: 1px dashed #9CA3AF;
      }
      .linksnap-fetching {
        background: linear-gradient(
          90deg,
          rgba(243, 244, 246, 0.2) 0%,
          rgba(229, 231, 235, 0.6) 50%,
          rgba(243, 244, 246, 0.2) 100%
        );
        background-size: 200% 100%;
        animation: shimmer 2s infinite linear;
      }
      .linksnap-done {
        background-color: rgba(16, 185, 129, 0.1);
        border: 1px solid #10B981;
      }
      .linksnap-error {
        background-color: rgba(239, 68, 68, 0.1);
        border: 1px solid #EF4444;
      }
      .linksnap-tooltip {
        position: absolute;
        top: -24px;
        left: 50%;
        transform: translateX(-50%);
        background-color: #1F2937;
        color: white;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 12px;
        white-space: nowrap;
        opacity: 0;
        transition: opacity 0.2s ease;
      }
      .linksnap-highlight:hover .linksnap-tooltip {
        opacity: 1;
      }
      @keyframes shimmer {
        0% {
            background-position: 200% 0;
      }
        100% {
          background-position: -200% 0;
        }
      }
      #${SELECTORS.LOADING_ID} {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 20px;
        border-radius: 8px;
        display: none;
        align-items: center;
        z-index: 10001;
      }
      .linksnap-spinner {
        width: 20px;
        height: 20px;
        border: 2px solid #f3f3f3;
        border-top: 2px solid #3498db;
        border-radius: 50%;
        animation: spin 1s linear infinite;
        margin-right: 10px;
      }
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
      .linksnap-hidden {
        display: none !important;
      }
    `;
    document.head.appendChild(styles);
  }
}

function generateId(text: string): string {
  return text.replace(/\W/g, "_");
}

function findRangeForMatch(element: Element, searchText: string): Range | null {
  const text = element.textContent || "";
  const index = text.indexOf(searchText);
  if (index === -1) return null;

  const range = document.createRange();
  let currentIndex = 0;

  function findTextNode(node: Node): boolean {
    if (node.nodeType === Node.TEXT_NODE) {
      const nodeText = node.textContent || "";
      if (currentIndex + nodeText.length > index) {
        range.setStart(node, index - currentIndex);
        range.setEnd(node, index - currentIndex + searchText.length);
        return true;
      }
      currentIndex += nodeText.length;
    } else {
      for (const childNode of Array.from(node.childNodes)) {
        if (findTextNode(childNode)) return true;
      }
    }
    return false;
  }

  findTextNode(element);
  return range;
}

function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default defineContentScript({
  matches: ["https://claude.ai/*"],
  main() {
    const linkSnap = new LinkSnapProcessor();
    linkSnap.init();
  },
});
