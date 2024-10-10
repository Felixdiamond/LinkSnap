import { defineBackground } from "wxt/sandbox";
import { storage } from "wxt/storage";

const firecrawlKeyStorage = storage.defineItem<string>("local:firecrawlApiKey");
const optionsStorage = storage.defineItem<{
  extractSchema: boolean;
  captureScreenshot: boolean;
  fullPageContent: boolean;
  maxTimeout: number;
}>("sync:options");

interface ExtractSchema {
  title: string;
  summary: string;
  keyPoints: string[];
  technicalDetails?: {
    technologies?: string[];
    apis?: string[];
    frameworks?: string[];
  };
  pricing?: {
    model: string;
    hasFreeOption: boolean;
    startingPrice?: string;
  };
}

class EnhancedFirecrawlWrapper {
  private app: any = null;
  private FirecrawlApp: any = null;
  private options = {
    extractSchema: true,
    captureScreenshot: true,
    fullPageContent: false,
    maxTimeout: 30000,
  };

  async initialize() {
    const storedOptions = await optionsStorage.getValue();
    if (storedOptions) {
      this.options = { ...this.options, ...storedOptions };
    }
  }

  async getApiKey(): Promise<string> {
    const storedKey = await firecrawlKeyStorage.getValue();
    if (!storedKey) {
      throw new Error("Firecrawl API key not found");
    }
    return storedKey;
  }

  async getApp(): Promise<any> {
    if (!this.app) {
      if (!this.FirecrawlApp) {
        const module = await import("@mendable/firecrawl-js");
        this.FirecrawlApp = module.default;
      }
      const apiKey = await this.getApiKey();
      this.app = new this.FirecrawlApp({ apiKey });
    }
    return this.app;
  }

  async scrapeUrl(url: string): Promise<any> {
    try {
      const app = await this.getApp();
      console.log("Scraping URL:", url, "with options:", this.options);

      const formats = ["markdown"];
      if (this.options.captureScreenshot) formats.push("screenshot");

      const scrapeOptions: any = {
        formats,
        onlyMainContent: !this.options.fullPageContent,
        timeout: this.options.maxTimeout,
      };

      if (this.options.extractSchema) {
        formats.push("extract");
        scrapeOptions.extract = {
          schema: {
            type: "object",
            properties: {
              title: { type: "string" },
              summary: { type: "string" },
              keyPoints: {
                type: "array",
                items: { type: "string" },
              },
              technicalDetails: {
                type: "object",
                properties: {
                  technologies: {
                    type: "array",
                    items: { type: "string" },
                  },
                  apis: {
                    type: "array",
                    items: { type: "string" },
                  },
                  frameworks: {
                    type: "array",
                    items: { type: "string" },
                  },
                },
              },
              pricing: {
                type: "object",
                properties: {
                  model: { type: "string" },
                  hasFreeOption: { type: "boolean" },
                  startingPrice: { type: "string" },
                },
              },
            },
            required: ["title", "summary", "keyPoints"],
          },
        };
      }

      const response = await app.scrapeUrl(url, scrapeOptions);

      if (response.success === true) {
        console.log("Scraping response:", response);
        const processedResponse = this.processResponse(response);
        return { success: true, data: processedResponse };
      } else {
        throw new Error(response.error || "Scraping failed");
      }
    } catch (error) {
      console.error("Scraping error:", error);
      return {
        success: false,
        error: error.message,
        errorDetails: error,
      };
    }
  }

  private processResponse(response: any) {
    let markdownContent = response.markdown || "";

    if (response.extract) {
      markdownContent = this.formatExtractedData(response.extract) + "\n\n" + markdownContent;
    }

    if (response.screenshot) {
      const screenshotUrl = response.screenshot.startsWith("data:")
        ? response.screenshot
        : `data:image/png;base64,${response.screenshot}`;

      markdownContent += `\n\n![Page Screenshot](${screenshotUrl})`;
    }

    console.log("Returning: ", {
      markdown: markdownContent,
      metadata: response.metadata || {},
      originalData: response,
    })
    
    return {
      markdown: markdownContent,
      metadata: response.metadata || {},
      originalData: response,
    };
  }

  private formatExtractedData(extract: ExtractSchema): string {
    let markdown = `# ${extract.title}\n\n`;
    markdown += `## Summary\n${extract.summary}\n\n`;

    markdown += "## Key Points\n";
    extract.keyPoints.forEach((point) => {
      markdown += `- ${point}\n`;
    });

    if (extract.technicalDetails) {
      markdown += "\n## Technical Details\n";
      if (extract.technicalDetails.technologies) {
        markdown +=
          "### Technologies\n" +
          extract.technicalDetails.technologies
            .map((t) => `- ${t}`)
            .join("\n") +
          "\n";
      }
      if (extract.technicalDetails.apis) {
        markdown +=
          "### APIs\n" +
          extract.technicalDetails.apis.map((a) => `- ${a}`).join("\n") +
          "\n";
      }
      if (extract.technicalDetails.frameworks) {
        markdown +=
          "### Frameworks\n" +
          extract.technicalDetails.frameworks.map((f) => `- ${f}`).join("\n") +
          "\n";
      }
    }

    if (extract.pricing) {
      markdown += "\n## Pricing\n";
      markdown += `- Model: ${extract.pricing.model}\n`;
      markdown += `- Free Option: ${
        extract.pricing.hasFreeOption ? "Yes" : "No"
      }\n`;
      if (extract.pricing.startingPrice) {
        markdown += `- Starting Price: ${extract.pricing.startingPrice}\n`;
      }
    }

    return markdown;
  }
}

const firecrawl = new EnhancedFirecrawlWrapper();

export default defineBackground(() => {
  let pendingRequests = new Map();

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "fetchContext") {
      const requestId = Math.random().toString(36).substring(7);
      pendingRequests.set(requestId, sendResponse);

      firecrawl.scrapeUrl(request.url).then((result) => {
        const sendResponseFn = pendingRequests.get(requestId);
        if (sendResponseFn) {
          sendResponseFn(result);
          pendingRequests.delete(requestId);
        }
      });

      return true;
    }
  });

  firecrawl.initialize();
});
