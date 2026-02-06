const mimeDb = require('mime-db');

// Build MIME_TYPE_EXTENSIONS map (same as Ship SDK)
const MIME_TYPE_EXTENSIONS = new Map(
  Object.entries(mimeDb)
    .filter(([_, data]) => data.extensions)
    .map(([type, data]) => [type, new Set(data.extensions)])
);

function validateFileExtension(filename, mimeType) {
  if (filename.startsWith('.')) {
    return true;
  }

  const nameParts = filename.toLowerCase().split('.');
  if (nameParts.length > 1 && nameParts[nameParts.length - 1]) {
    const extension = nameParts[nameParts.length - 1];
    const allowedExtensions = MIME_TYPE_EXTENSIONS.get(mimeType);
    if (allowedExtensions && !allowedExtensions.has(extension)) {
      return false;
    }
  }
  return true;
}

// Test files from error message
const testFiles = [
  { name: 'swiper-bundle.min.js.map', mime: 'application/json' },
  { name: 'bootstrap-grid.rtl.min.css.map', mime: 'application/json' },
  { name: 'bootstrap-icons.scss', mime: 'text/x-scss' },
  { name: 'bootstrap-icons.woff2', mime: 'font/woff2' },
];

console.log('Testing file extension validation:\n');
testFiles.forEach(({ name, mime }) => {
  const valid = validateFileExtension(name, mime);
  const allowedExts = MIME_TYPE_EXTENSIONS.get(mime);
  const lastExt = name.split('.').pop();
  console.log(name);
  console.log('  MIME: ' + mime);
  console.log('  Extension: .' + lastExt);
  console.log('  Allowed: ' + (allowedExts ? Array.from(allowedExts).join(', ') : 'none'));
  console.log('  Valid: ' + valid + '\n');
});
