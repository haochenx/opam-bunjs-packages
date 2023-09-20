#!/bin/bash -e

LISTING_COUNT_LIMIT=50
# NB: it's known the currently we can only handle max 50 releases.
# we will deal with this when we have to

pushd () {
    command pushd "$@" > /dev/null
}

popd () {
    command popd "$@" > /dev/null
}

while getopts 'j:r:h' opt; do
  case "$opt" in
    j)
      JAR_DEST="$OPTARG"
      ;;
    r)
      RAW_DEST="$OPTARG"
      ;;
    h)
      echo "Usage: $(basename $0) [-j jar_json_destination] [-o raw_json_destination]"
      exit 2
      ;;
  esac
done

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

pushd "$TEMPD"

curl -sL \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  https://api.github.com/repos/oven-sh/bun/releases?per_page=$LISTING_COUNT_LIMIT \
  > raw.json

cat raw.json | jq 'map ({tag_name, info: {name, url}, assets}) | map( {(.tag_name): [.info
, (.tag_name | . as $raw | try split("-")[1] catch $raw | . as $raw_ver | try split("v")[1] catch $raw_ver | . as $ver | { tag: $raw, version: $ver, versionParsed: (. | split(".") | try map (tonumber) catch null)})
, {assets: .assets | map ({name, info: {size, state, content_type, browser_download_url}}) | map ({(.name): .info}) | add }] | add}) | add' \
  > jar.json

popd

if [ -n "$JAR_DEST" ]; then
  cp "$TEMPD/jar.json" "$JAR_DEST"
fi
if [ -n "$RAW_DEST" ]; then
  cp "$TEMPD/raw.json" "$RAW_DEST"
fi

cat "$TEMPD/jar.json" | jq -re 'keys[]'
