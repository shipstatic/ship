# Demo Site Documentation

This is a demo site used for CLI testing purposes.

## Structure

```
demo-site/
├── index.html          # Main HTML file
├── styles/
│   └── main.css        # CSS styles
├── scripts/
│   └── main.js         # JavaScript functionality
├── images/
│   └── demo.jpg        # Sample image
├── data/
│   └── sample.json     # JSON data file
├── docs/
│   └── README.md       # This documentation
└── assets/
    └── manifest.json   # Web app manifest
```

## Purpose

This demo site serves as a test fixture for CLI deployment testing. It contains:

1. **HTML Content** - Basic webpage structure
2. **CSS Styling** - Responsive design and animations
3. **JavaScript** - Interactive functionality
4. **Images** - Binary file testing
5. **JSON Data** - Structured data files
6. **Documentation** - Markdown content

## File Count

The site contains exactly **10 files** to provide consistent testing:

- 1 HTML file
- 1 CSS file  
- 1 JavaScript file
- 1 Image file
- 1 JSON data file
- 1 Markdown file
- 4 Additional test files

## Testing Notes

- Total size should be approximately 65-67KB
- All files should be deployable via ship CLI
- Directory structure tests path handling
- Various file types test upload functionality
- Consistent file count enables predictable testing

## Usage in Tests

```bash
# Deploy the demo site
ship /path/to/demo-site

# Or explicitly
ship deployments create /path/to/demo-site

# JSON format
ship deployments create /path/to/demo-site --json
```

## Expected Output

When deployed, the site should show:
- Files: 10
- Size: ~65.9Kb (human format) or ~67446 bytes (JSON format)  
- Status: success
- Config: no (unless ship.json is present)
- URL: https://[deployment-id].statichost.dev