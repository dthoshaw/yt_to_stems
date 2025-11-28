# pipeline.py
import argparse
from pathlib import Path
from converter import download_yt_to_mp3
from splitter import split_mp3_to_stems


def youtube_to_stems(url: str, name: str, output_root: str = "."):
    output_dir = Path(output_root) / name
    output_dir.mkdir(parents=True, exist_ok=True)
    status_file = Path(output_root) / "status.txt"

    mp3_path = output_dir / f"{name}.mp3"
    print(f"Downloading: {url}")
    try:
        title, duration = download_yt_to_mp3(url, str(mp3_path), max_duration=360)
        print(f"Title: {title} | Duration: {duration//60}m{duration%60}s")
    except ValueError as e:
        print(f"Rejected: {e}")
        status_file.write_text("error")
        (Path(output_root) / "error.txt").write_text(str(e))
        return

    status_file.write_text("splitting")
    print(f"Splitting into stems...")
    try:
        stems, bpm, key = split_mp3_to_stems(str(mp3_path), str(output_dir), status_file=status_file)
        metadata_file = Path(output_root) / "metadata.txt"
        metadata_file.write_text(f"BPM: {bpm:.1f}\nKey: {key}\n")
        status_file.write_text("done")
    except Exception as e:
        print(f"Error during splitting: {e}")
        status_file.write_text("error")
        (Path(output_root) / "error.txt").write_text(str(e))
        return

    try:
        mp3_path.unlink()
        print(f"Cleaned up: {mp3_path.name}")
    except Exception:
        pass

    print(f"\nRAVEDROP COMPLETE!")
    print(f"Folder: {output_dir}")
    for s in sorted(stems):
        print(f"   • {Path(s).name}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="YouTube → Named Stems (≤6min)")
    parser.add_argument("--url", required=True, help="YouTube URL")
    parser.add_argument("--name", required=True, help="Song name (used for folder & files)")
    parser.add_argument("--output", default=".", help="Output root folder")
    args = parser.parse_args()

    youtube_to_stems(args.url, args.name, args.output)