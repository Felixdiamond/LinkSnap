# LinkSnap

LinkSnap is a browser extension that enhances Claude's web interface by allowing it to access and process web content directly within conversations.

## Features

- Fetch web content for Claude to analyze
- Visual feedback on link processing status
- Caching of fetched content for improved performance
- Multiple output formats including Markdown and screenshots
- Seamless integration with Claude's interface

## Building

- A simple `npm install` and `npm run dev` should get you started in dev mode
- `npm run build` and `npm run zip` to build and zip

All should be found in the `.output` directory

## Installation

1. Install the LinkSnap extension for your browser
2. Open the Claude web interface
3. Paste your Firecrawl API key in the designated field within the extension settings

## Usage

1. In the Claude chat interface, type `@link` followed by a space and the URL you want Claude to access (e.g., `@link https://example.com`)
2. Press the spacebar to initiate the fetch process
3. Watch for visual feedback:
   - Shimmering grey: Fetching in progress
   - Green: Fetch successful
   - Red: Fetch failed
4. Once the fetch is complete, compose your message to Claude
5. Send your message - LinkSnap will automatically inject the fetched context before sending

## Options

- Choose between different output formats:
  - Markdown
  - Screenshots
  - Extract
  - Html
  - (More coming soon)

## Contributing

We welcome contributions to LinkSnap! If you'd like to contribute, please:

1. Fork the repository
2. Create a new branch for your feature or bug fix
3. Submit a pull request with a clear description of your changes

## Support

If you encounter any issues or have questions, please open an issue on our GitHub repository.