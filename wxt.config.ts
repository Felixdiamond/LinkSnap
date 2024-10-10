import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  manifest: {
    name: "LinkSnap",
    description: "Enhance Claude with web context",
    action: {
      default_title: "LinkSnap"
    },
    permissions: ["storage", "activeTab", "tabs", "scripting", "clipboardWrite", "clipboardRead"],
  },
  modules: ['@wxt-dev/module-react'],
});
