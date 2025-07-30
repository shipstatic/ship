#compdef ship

# Only define the completion function if we're in a completion context
if [[ -n ${ZSH_VERSION-} ]]; then
  _ship() {
    local -a completions
    local state line
    
    # Only proceed if we're actually in a completion context
    if [[ -z ${words-} ]]; then
      return 1
    fi
    
    # The word being completed
    local current_word="${words[CURRENT]}"
    # The previous word  
    local prev_word="${words[CURRENT-1]}"

    # --- File Path Logic ---
    # If the user is typing a path, use native file completion immediately.
    if [[ "$current_word" == \~* || "$current_word" == \/* || "$current_word" == \./* || "$current_word" == \.\./* ]]; then
      _files
      return
    fi

    # If the previous command expects a file path, also use file completion.
    if [[ "$prev_word" == "create" || "$prev_word" == "--config" || "$prev_word" == "-c" ]]; then
      _files
      return
    fi

    # --- Command Completion Logic ---
    # If we're not completing a path, call our Node.js script for command suggestions.
    # We pass the full command line and cursor position to our script for context.
    completions=($(ship --compzsh --compgen="${BUFFER}" --compword="${CURRENT}" 2>/dev/null))

    if [[ ${#completions[@]} -gt 0 ]]; then
      _describe 'commands' completions
    fi
  }

  # Only register the completion if compdef is available
  if (( ${+functions[compdef]} )); then
    compdef _ship ship
  fi
fi