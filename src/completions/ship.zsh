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

    # Context-aware completions based on command structure
    case "${words[2]}" in
      "deployments")
        case "${words[3]}" in
          "create")
            # File/directory completion for deploy path
            _files
            return
            ;;
          "get"|"remove")
            if [[ $CURRENT -eq 4 ]]; then
              # Would ideally complete deployment IDs from API, but keep simple for now
              return
            fi
            ;;
          *)
            if [[ $CURRENT -eq 3 ]]; then
              completions=("list:List all deployments" "create:Create deployment from file or directory" "get:Show deployment information" "remove:Delete deployment permanently")
              _describe 'deployments commands' completions
              return
            fi
            ;;
        esac
        ;;
      "aliases")
        case "${words[3]}" in
          "set")
            if [[ $CURRENT -eq 5 ]]; then
              # Would ideally complete deployment IDs, but keep simple
              return
            fi
            ;;
          "get"|"remove")
            if [[ $CURRENT -eq 4 ]]; then
              # Would ideally complete alias names, but keep simple
              return
            fi
            ;;
          *)
            if [[ $CURRENT -eq 3 ]]; then
              completions=("list:List all aliases" "get:Show alias information" "set:Create or update alias pointing to deployment" "remove:Delete alias permanently")
              _describe 'aliases commands' completions
              return
            fi
            ;;
        esac
        ;;
      "account")
        if [[ $CURRENT -eq 3 ]]; then
          completions=("get:Show account information")
          _describe 'account commands' completions
          return
        fi
        ;;
      "completion")
        if [[ $CURRENT -eq 3 ]]; then
          completions=("install:Install shell completion script" "uninstall:Uninstall shell completion script")
          _describe 'completion commands' completions
          return
        fi
        ;;
    esac

    # If the previous command expects a file path, also use file completion.
    if [[ "$prev_word" == "create" || "$prev_word" == "--config" ]]; then
      _files
      return
    fi

    # Flag completion
    if [[ "$current_word" == --* ]]; then
      completions=("--api-key:API key for authentication" "--config:Custom config file path" "--api-url:API URL (for development)" "--preserve-dirs:Preserve directory structure in deployment" "--json:Output results in JSON format" "--no-color:Disable colored output" "--version:Show version information" "--help:Display help for command")
      _describe 'options' completions
      return
    fi

    # Top-level commands
    if [[ $CURRENT -eq 2 ]]; then
      completions=("ping:Check API connectivity" "whoami:Get current account information" "deployments:Manage deployments" "aliases:Manage aliases" "account:Manage account" "completion:Setup shell completion")
      _describe 'commands' completions
      return
    fi

    # Default: no completions
    return 1
  }

  # Only register the completion if compdef is available
  if (( ${+functions[compdef]} )); then
    compdef _ship ship
  fi
fi