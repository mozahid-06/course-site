#!/usr/bin/env bash
# Turns videos/<Section>/<Lesson>.mp4 into hls/<Section>/<Lesson>/index.m3u8 + segments.
# Usage: ./tools/make-hls.sh [source_dir] [output_dir]   (needs ffmpeg)
set -euo pipefail
src="${1:-videos}"; out="${2:-hls}"
# Extracts embedded subtitle tracks to WebVTT next to the playlist. Runs before the
# "already encoded" skip so a re-run adds subtitles without re-encoding the video.
subs() {
  local f="$1" dest="$2" lang used n idx codec tag
  declare -A seen=()
  while IFS='|' read -r idx codec tag; do
    case "$codec" in
      hdmv_pgs_subtitle|dvd_subtitle|dvb_*|xsub) echo "  skip bitmap subtitle #$idx"; continue ;;
    esac
    lang="$(printf '%s' "$tag" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g')"
    [ -n "$lang" ] || lang=und
    n=$(( ${seen[$lang]:-0} + 1 )); seen[$lang]=$n
    used="$dest/index.$lang.vtt"
    [ "$n" -gt 1 ] && used="$dest/index.$lang.$n.vtt"
    echo "  subtitle #$idx -> ${used#*/}"
    ffmpeg -nostdin -loglevel error -y -i "$f" -map "0:$idx" -c:s webvtt "$used"
  done < <(ffprobe -v error -select_streams s -show_entries stream=index,codec_name:stream_tags=language -of csv=p=0 "$f" | awk -F, '{print $1"|"$2"|"$3}')
}

find "$src" -type f \( -iname '*.mp4' -o -iname '*.mkv' -o -iname '*.mov' -o -iname '*.webm' \) -print0 |
while IFS= read -r -d '' f; do
  rel="${f#"$src"/}"; dest="$out/${rel%.*}"; mkdir -p "$dest"
  subs "$f" "$dest"
  [ -f "$dest/index.m3u8" ] && { echo "skip $rel"; continue; }
  echo "convert $rel"
  ffmpeg -nostdin -loglevel error -y -i "$f" -sn -c:v libx264 -preset veryfast -crf 23 -c:a aac -b:a 128k \
    -f hls -hls_time 6 -hls_playlist_type vod -hls_segment_filename "$dest/seg_%04d.ts" "$dest/index.m3u8"
done

# PDFs are copied as-is, keeping the same folder structure
find "$src" -type f -iname '*.pdf' -print0 |
while IFS= read -r -d '' f; do
  rel="${f#"$src"/}"; mkdir -p "$out/$(dirname "$rel")"; cp -n "$f" "$out/$rel"; echo "copy $rel"
done
