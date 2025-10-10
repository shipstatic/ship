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
        "get"|"remove")
          if [[ ${COMP_CWORD} -eq 3 ]]; then
            # Would ideally complete deployment IDs from API, but keep simple for now
            COMPREPLY=()
            return
          fi
          ;;
        *)
          if [[ ${COMP_CWORD} -eq 2 ]]; then
            completions="list create get remove"
            COMPREPLY=( $(compgen -W "${completions}" -- "${current_word}") )
            return
          fi
          ;;
      esac
      ;;
    "domains")
      case "${COMP_WORDS[2]}" in
        "set")
          if [[ ${COMP_CWORD} -eq 4 ]]; then
            # Would ideally complete deployment IDs, but keep simple
            COMPREPLY=()
            return
          fi
          ;;
        "get"|"remove")
          if [[ ${COMP_CWORD} -eq 3 ]]; then
            # Would ideally complete domain names, but keep simple
            COMPREPLY=()
            return
          fi
          ;;
        *)
          if [[ ${COMP_CWORD} -eq 2 ]]; then
            completions="list get set remove"
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

  # Delegate for commands that expect files, like 'create'
  if [[ "$prev_word" == "create" || "$prev_word" == "--config" ]]; then
    COMPREPLY=( $(compgen -f -- "${current_word}") )
    return
  fi

  # Flag completion
  if [[ "$current_word" == --* ]]; then
    completions="--api-key --config --api-url --no-path-detect --no-spa-detect --json --no-color --version --help"
    COMPREPLY=( $(compgen -W "${completions}" -- "${current_word}") )
    return
  fi

  # Top-level commands
  if [[ ${COMP_CWORD} -eq 1 ]]; then
    completions="ping whoami deployments domains account completion"
    COMPREPLY=( $(compgen -W "${completions}" -- "${current_word}") )
    return
  fi

  # Default: no completions
  COMPREPLY=()
}

# Register the completion function for the 'ship' command
complete -F _ship_completions ship