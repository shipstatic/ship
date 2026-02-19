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

  # Context-aware completions based on command structure
  case "${COMP_WORDS[1]}" in
    "deployments")
      case "${COMP_WORDS[2]}" in
        "create")
          # File/directory completion for deploy path
          COMPREPLY=( $(compgen -f -- "${current_word}") )
          return
          ;;
        "get"|"set"|"remove")
          # Deployment ID position
          COMPREPLY=()
          return
          ;;
        *)
          if [[ ${COMP_CWORD} -eq 2 ]]; then
            completions="list create get set remove"
            COMPREPLY=( $(compgen -W "${completions}" -- "${current_word}") )
            return
          fi
          ;;
      esac
      ;;
    "domains")
      case "${COMP_WORDS[2]}" in
        "set")
          # Domain name or deployment ID positions
          COMPREPLY=()
          return
          ;;
        "get"|"validate"|"verify"|"remove")
          # Domain name position
          COMPREPLY=()
          return
          ;;
        *)
          if [[ ${COMP_CWORD} -eq 2 ]]; then
            completions="list get set validate verify remove"
            COMPREPLY=( $(compgen -W "${completions}" -- "${current_word}") )
            return
          fi
          ;;
      esac
      ;;
    "tokens")
      case "${COMP_WORDS[2]}" in
        "remove")
          # Token ID position
          COMPREPLY=()
          return
          ;;
        *)
          if [[ ${COMP_CWORD} -eq 2 ]]; then
            completions="list create remove"
            COMPREPLY=( $(compgen -W "${completions}" -- "${current_word}") )
            return
          fi
          ;;
      esac
      ;;
    "account")
      if [[ ${COMP_CWORD} -eq 2 ]]; then
        completions="get"
        COMPREPLY=( $(compgen -W "${completions}" -- "${current_word}") )
        return
      fi
      ;;
    "completion")
      if [[ ${COMP_CWORD} -eq 2 ]]; then
        completions="install uninstall"
        COMPREPLY=( $(compgen -W "${completions}" -- "${current_word}") )
        return
      fi
      ;;
  esac

  # Delegate for commands that expect files
  if [[ "$prev_word" == "create" || "$prev_word" == "--config" ]]; then
    COMPREPLY=( $(compgen -f -- "${current_word}") )
    return
  fi

  # Flag completion
  if [[ "$current_word" == --* ]]; then
    completions="--api-key --deploy-token --config --api-url --label --no-path-detect --no-spa-detect --json --no-color --version --help"
    COMPREPLY=( $(compgen -W "${completions}" -- "${current_word}") )
    return
  fi

  # Top-level commands
  if [[ ${COMP_CWORD} -eq 1 ]]; then
    completions="ping whoami deployments domains tokens account config completion"
    COMPREPLY=( $(compgen -W "${completions}" -- "${current_word}") )
    return
  fi

  # Default: no completions
  COMPREPLY=()
}

# Register the completion function for the 'ship' command
complete -F _ship_completions ship
