# ship.fish

# Don't complete if it looks like a path
function __ship_is_path
  set -l cmd (commandline -opc)
  if test (count $cmd) -gt 1
    # The last token will be what we are completing
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

# Command completion by calling the CLI
complete -c ship -n '__fish_use_subcommand' -a '(ship --compfish --compgen (commandline -b) 2>/dev/null)'
complete -c ship -n 'not __ship_is_path' -a '(ship --compfish --compgen (commandline -b) 2>/dev/null)'