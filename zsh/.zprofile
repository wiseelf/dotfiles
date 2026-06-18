# Bootstrap Homebrew (ARM Mac: /opt/homebrew, Intel: /usr/local)
for _brew_prefix in /opt/homebrew /usr/local; do
  [[ -x $_brew_prefix/bin/brew ]] && eval "$($_brew_prefix/bin/brew shellenv)" && break
done
unset _brew_prefix
