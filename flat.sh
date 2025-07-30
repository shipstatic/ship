#!/bin/bash

output="flat.txt"
exclude_pattern='.git|node_modules|dist|tests|flat.txt|flat.sh|*.log|pnpm-lock.yaml|.DS_Store|*.svg'

# 1. Write directory tree to the output file
tree -a -I "$exclude_pattern" ./ > "$output"

# 2. Use find with explicit exclusions (matching the tree pattern)
find ./ -type f \
  ! -path "*/.git/*" \
  ! -path "*/node_modules/*" \
  ! -path "*/dist/*" \
  ! -path "*/tests/*" \
  ! -name "flat.txt" \
  ! -name "flat.sh" \
  ! -name "*.log" \
  ! -name "pnpm-lock.yaml" \
  ! -name ".DS_Store" \
  ! -name "*.svg" \
  | while read -r file; do
  echo -e "\n\n--- START OF FILE: $file ---" >> "$output"
  cat "$file" >> "$output"
  echo -e "\n--- END OF FILE: $file ---" >> "$output"
done