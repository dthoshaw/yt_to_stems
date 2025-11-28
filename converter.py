# converter.py
import os
import argparse
from typing import Tuple, Optional

import yt_dlp
from pydub import AudioSegment


def download_yt_to_mp3(
    url: str,
    output_path: str,
    max_duration: int = 360,  # 6 minutes in seconds
) -> Tuple[str, int]:
    """
    Downloads YouTube audio to MP3 with title and duration check.

    Returns:
        (title, duration_seconds)
    """
    temp_template = os.path.join(os.path.dirname(output_path), 'temp_yt_%(id)s')
    video_id = None

    ydl_opts = {
        'format': 'bestaudio/best',
        'outtmpl': temp_template,
        'quiet': True,
        'noplaylist': True,
        'no_warnings': False,
        'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'mp3',
            'preferredquality': '192',
            'nopostoverwrites': True,
        }],
        'extractor_args': {
            'youtube': {
                'player_client': ['web', 'mweb', 'android'],   # most reliable combo in 2025
                'skip': ['dash', 'hls'],
            }
        },
        'extractor_args': {'youtube': {'js_runtime': 'node'}},
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            video_id = info.get('id')
            title = info.get('title', 'Unknown')
            duration = info.get('duration', 0)

            if duration > max_duration:
                raise ValueError(f"Video too long: {duration//60}m > 6m limit.")

        temp_mp3 = f"{temp_template.replace('%(id)s', video_id)}.mp3"
        if not os.path.exists(temp_mp3):
            raise RuntimeError("MP3 not created.")

        # Copy to final path
        final_audio = AudioSegment.from_file(temp_mp3)
        final_audio.export(output_path, format="mp3", bitrate="192k")
        print(f"Downloaded: {os.path.basename(output_path)} ({duration}s)")

    except Exception as e:
        raise e
    finally:
        # Cleanup
        if video_id:
            for ext in ['.mp3', '.webm', '.m4a', '.opus']:
                f = f"{temp_template.replace('%(id)s', video_id)}{ext}"
                if os.path.exists(f):
                    try: os.remove(f)
                    except: pass

    return title, duration


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    download_yt_to_mp3(args.url, args.output)