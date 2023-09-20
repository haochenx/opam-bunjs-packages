#/bin/bash -e

pushd () {
    command pushd "$@" > /dev/null
}

popd () {
    command popd "$@" > /dev/null
}

print_help_and_exit() {
  echo "Usage: $(basename $0) [-v][-j jar_json] tag_name..."
  exit 2
}

script_args=()
while [ $OPTIND -le "$#" ]
do
    if getopts j:hv option
    then
        case $option
        in
          h)
            print_help_and_exit
            ;;
          j)
            JAR_JSON="$OPTARG"
            ;;
          v)
            VERBOSE=y
            ;;
        esac
    else
        script_args+=("${!OPTIND}")
        ((OPTIND++))
    fi
done

if [ ! -f "$JAR_JSON" ]; then
  print_help_and_exit
fi

TEMPD=$(mktemp -d)
if [ ! -e "$TEMPD" ]; then
    >&2 echo "Failed to create temp directory"
    exit 1
fi

# Make sure the temp directory gets removed on script exit.
if [ ! -n "$KEEP_TEMP" ]; then
  trap "exit 1"           HUP INT PIPE QUIT TERM
  trap 'rm -rf "$TEMPD"'  EXIT
else
  echo "tempdir: $TEMPD"
fi

cp "$JAR_JSON" "$TEMPD/jar.json"
pushd "$TEMPD"

echo "" > shasum256-all.json
for tag in "${script_args[@]}"; do
  if [ -n "$VERBOSE" ]; then echo processing $tag; fi
  if shasum_url=$(cat jar.json | jq -re ".[\"$tag\"].assets[\"SHASUMS256.txt\"].browser_download_url"); then
    shasum_file="$tag-shasum256.txt"
    curl -sL "$shasum_url" > "$shasum_file"
    cat "$shasum_file" | jq -R 'split("  ")' | jq -e --slurp "try map ({(.[1]): {sha256: .[0]}}) | add | {\"$tag\": .}" \
      >> shasum256-all.json
  fi
done
cat shasum256-all.json | jq --slurp ". | add"

popd
