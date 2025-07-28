#!/usr/bin/env bash

_ship_completions() {
  # COMP_CWORD is the index of the current word
  # COMP_WORDS is an array of words in the current command
  local current_word="${COMP_WORDS[COMP_CWORD]}"
  local prev_word="${COMP_WORDS[COMP_CWORD-1]}"
  local completions

  # Delegate to native file completion if the word looks like a path
  if [[ "$current_word" == ~* || "$current_word" == /* || "$current_word" == .* ]]; then
    COMPREPLY=( $(compgen -f -- "${current_word}") )
    return
  fi

  # Delegate for commands that expect files, like 'create'
  if [[ "$prev_word" == "create" || "$prev_word" == "--config" || "$prev_word" == "-c" ]]; then
    COMPREPLY=( $(compgen -f -- "${current_word}") )
    return
  fi

  # Otherwise, call your CLI for command completions
  completions=$(ship --compbash --compgen="${COMP_LINE}" 2>/dev/null)
  
  # Filter completions based on the current word and reply
  COMPREPLY=( $(compgen -W "${completions}" -- "${current_word}") )
}

# Register the completion function for the 'ship' command
complete -F _ship_completions ship