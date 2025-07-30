#!/usr/bin/env node

/**
 * Script to convert all CLI tests from sync to async
 * Converts runCli calls to await runCli and adds async to test functions
 */

const fs = require('fs');
const path = require('path');

function convertFileToAsync(filePath) {
  console.log(`Converting ${filePath}...`);
  
  let content = fs.readFileSync(filePath, 'utf8');
  
  // Convert test function declarations to async
  content = content.replace(
    /it\(['"`]([^'"`]+)['"`],\s*\(\)\s*=>\s*\{/g,
    "it('$1', async () => {"
  );
  
  // Convert runCli calls to await runCli
  content = content.replace(
    /const\s+(\w+)\s*=\s*runCli\(/g,
    'const $1 = await runCli('
  );
  
  // Also handle cases without const assignment
  content = content.replace(
    /(?<!await\s)runCli\(/g,
    'await runCli('
  );
  
  // Remove any double awaits that might have been created
  content = content.replace(/await\s+await\s+/g, 'await ');
  
  fs.writeFileSync(filePath, content);
  console.log(`✓ Converted ${filePath}`);
}

// Find all CLI test files
const testDir = path.join(__dirname, 'tests', 'cli');
const testFiles = fs.readdirSync(testDir)
  .filter(file => file.endsWith('.test.ts'))
  .map(file => path.join(testDir, file));

console.log(`Found ${testFiles.length} test files to convert:`);
testFiles.forEach(file => console.log(`  ${path.basename(file)}`));

// Convert each file
testFiles.forEach(convertFileToAsync);

console.log('\\n✅ All CLI tests converted to async!');