# ship.fish - Tab completion for Ship CLI

# Helper function to check if we're completing a path
function __ship_is_path
  set -l cmd (commandline -opc)
  if test (count $cmd) -gt 1
    set -l last_token $cmd[-1]
    if string match -q -- "*/*" "$last_token"
      return 0
    end
    if string match -q -- "~*" "$last_token"
      return 0
    end
    if string match -q -- ".*" "$last_token"
      return 0
    end
  end
  return 1
end

# Helper function to check if we should complete files for certain commands
function __ship_needs_file
  set -l cmd (commandline -opc)
  if test (count $cmd) -ge 2
    set -l prev $cmd[-1]
    if test "$prev" = "create" -o "$prev" = "--config"
      return 0
    end
  end
  return 1
end

# Top-level commands
complete -c ship -f -n '__fish_use_subcommand' -a 'ping' -d 'Check API connectivity'
complete -c ship -f -n '__fish_use_subcommand' -a 'whoami' -d 'Get current account information'
complete -c ship -f -n '__fish_use_subcommand' -a 'deployments' -d 'Manage deployments'
complete -c ship -f -n '__fish_use_subcommand' -a 'aliases' -d 'Manage aliases'
complete -c ship -f -n '__fish_use_subcommand' -a 'account' -d 'Manage account'
complete -c ship -f -n '__fish_use_subcommand' -a 'completion' -d 'Setup shell completion'

# Global options
complete -c ship -l api-key -d 'API key for authentication' -x
complete -c ship -l config -d 'Custom config file path' -r
complete -c ship -l api-url -d 'API URL (for development)' -x
complete -c ship -l json -d 'Output results in JSON format'
complete -c ship -l no-color -d 'Disable colored output'
complete -c ship -l version -d 'Show version information'
complete -c ship -l help -d 'Display help for command'

# Deployments subcommands
complete -c ship -f -n '__fish_seen_subcommand_from deployments' -a 'list' -d 'List all deployments'
complete -c ship -f -n '__fish_seen_subcommand_from deployments' -a 'create' -d 'Create deployment from file or directory'
complete -c ship -f -n '__fish_seen_subcommand_from deployments' -a 'get' -d 'Show deployment information'
complete -c ship -f -n '__fish_seen_subcommand_from deployments' -a 'remove' -d 'Delete deployment permanently'

# Deployments create options
complete -c ship -l no-path-detect -d 'Disable automatic path optimization and flattening'
complete -c ship -l no-spa-detect -d 'Disable automatic SPA detection and configuration'

# Aliases subcommands
complete -c ship -f -n '__fish_seen_subcommand_from aliases' -a 'list' -d 'List all aliases'
complete -c ship -f -n '__fish_seen_subcommand_from aliases' -a 'get' -d 'Show alias information'
complete -c ship -f -n '__fish_seen_subcommand_from aliases' -a 'set' -d 'Create or update alias pointing to deployment'
complete -c ship -f -n '__fish_seen_subcommand_from aliases' -a 'remove' -d 'Delete alias permanently'

# Account subcommands
complete -c ship -f -n '__fish_seen_subcommand_from account' -a 'get' -d 'Show account information'

# Completion subcommands
complete -c ship -f -n '__fish_seen_subcommand_from completion' -a 'install' -d 'Install shell completion script'
complete -c ship -f -n '__fish_seen_subcommand_from completion' -a 'uninstall' -d 'Uninstall shell completion script'

# File completion for appropriate commands (only when not a path is being typed)
complete -c ship -F -n '__ship_needs_file and not __ship_is_path'