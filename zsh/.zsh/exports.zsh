export CLICOLOR=1
export LSCOLORS="Gxfxcxdxbxegedabagacad"

[[ -d /opt/homebrew/opt/helm@3/bin ]] && \
  export PATH="/opt/homebrew/opt/helm@3/bin:$PATH"
[[ -d /opt/homebrew/opt/mysql-client@8.0/bin ]] && \
  export PATH="/opt/homebrew/opt/mysql-client@8.0/bin:$PATH"
