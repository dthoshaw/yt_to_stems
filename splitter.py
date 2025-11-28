# splitter.py
import os
from pathlib import Path
from typing import List
import torch
import soundfile as sf
import numpy as np
import librosa
from scipy.signal import butter, lfilter
from mutagen.wave import WAVE
from demucs.pretrained import get_model
from demucs.apply import apply_model
from demucs.audio import AudioFile


# === BASS FILTER ===
def lowpass_filter(data, cutoff, fs, order=5):
    nyq = 0.5 * fs
    normal_cutoff = cutoff / nyq
    b, a = butter(order, normal_cutoff, btype='low', analog=False)
    return lfilter(b, a, data)


# === MELODY CLEANER ===
def spectral_gate(stem, ref_stem, sr, threshold=0.12):
    """Remove bleed from vocals/drums in melody using spectral gating"""
    S_stem = np.abs(librosa.stft(stem))
    S_ref = np.abs(librosa.stft(ref_stem))
    mask = S_stem > threshold * S_ref
    S_clean = S_stem * mask
    return librosa.istft(S_clean)


# === BPM DETECTION ===
def detect_bpm_from_array(drums_data: np.ndarray, sr: int) -> float:
    """Detect BPM from drums array using librosa (in-memory version)"""
    try:
        onset_env = librosa.onset.onset_strength(y=drums_data, sr=sr)
        tempo, _ = librosa.beat.beat_track(onset_envelope=onset_env, sr=sr)
        return float(tempo)
    except Exception as e:
        print(f"BPM detection failed: {e}")
        return 128.0  # Fallback EDM average


# === KEY DETECTION ===
def detect_key_from_audio(audio_data: np.ndarray, sr: int) -> str:
    """Detect musical key from audio using chroma features"""
    try:
        # Use melody or full mix for key detection (melody is better)
        chroma = librosa.feature.chroma_stft(y=audio_data, sr=sr)
        chroma_mean = np.mean(chroma, axis=1)
        
        # Key profiles for major and minor keys (Krumhansl-Schmuckler)
        major_profile = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
        minor_profile = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
        
        # Normalize profiles
        major_profile = major_profile / np.sum(major_profile)
        minor_profile = minor_profile / np.sum(minor_profile)
        chroma_mean = chroma_mean / np.sum(chroma_mean)
        
        # Correlate with all 12 major and minor keys
        keys = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
        best_corr = -1
        best_key = 'C major'
        
        for i in range(12):
            # Rotate chroma to match key
            rotated_chroma = np.roll(chroma_mean, -i)
            
            # Correlate with major
            major_corr = np.corrcoef(rotated_chroma, major_profile)[0, 1]
            if not np.isnan(major_corr) and major_corr > best_corr:
                best_corr = major_corr
                best_key = keys[i] + ' major'
            
            # Correlate with minor
            minor_corr = np.corrcoef(rotated_chroma, minor_profile)[0, 1]
            if not np.isnan(minor_corr) and minor_corr > best_corr:
                best_corr = minor_corr
                best_key = keys[i] + ' minor'
        
        return best_key
    except Exception as e:
        print(f"Key detection failed: {e}")
        return "Unknown"


# === EMBED BPM IN WAV ===
def embed_bpm_in_wav(wav_path: str, bpm: float):
    """Embed BPM in WAV file using ID3 tags for Ableton compatibility"""
    try:
        audio = WAVE(wav_path)
        # Add ID3 tag if it doesn't exist
        if audio.tags is None:
            audio.add_tags()
        
        # Set BPM using ID3 tags (Ableton recognizes TBPM frame)
        bpm_int = int(round(bpm))
        from mutagen.id3 import TBPM, TIT1, TXXX
        
        # Set TBPM (BPM frame)
        audio.tags.add(TBPM(encoding=3, text=str(bpm_int)))
        # Set content group description
        audio.tags.add(TIT1(encoding=3, text=f"BPM: {bpm:.1f}"))
        # Add custom TXXX frame for BPM
        audio.tags.add(TXXX(encoding=3, desc="BPM", text=str(bpm)))
        
        audio.save()
        print(f"Embedded BPM: {bpm:.1f} → {Path(wav_path).name}")
    except Exception as e:
        print(f"BPM embed failed (non-critical): {e}")


# === MAIN SPLITTER ===
def split_mp3_to_stems(
    input_path: str,
    output_dir: str,
    model_name: str = "mdx_extra_q",  # BEST FOR EDM
    device: str = None,
    progress: bool = True,
    include_full: bool = True,
    status_file = None,
) -> List[str]:
    input_path = Path(input_path)
    output_dir = Path(output_dir)
    output_dir.mkdir(exist_ok=True)

    if not input_path.exists():
        raise FileNotFoundError(f"Input not found: {input_path}")

    base_name = input_path.stem  # e.g., "Never_Gonna_Give_You_Up"

    # Device
    if device is None:
        device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"Using device: {device}")

    # Model
    print(f"Loading {model_name} model...")
    model = get_model(model_name)
    model.eval()
    if device == "cuda":
        model = model.cuda()
        # Use half precision for faster inference on CUDA (minimal quality impact)
        try:
            model = model.half()
            wav = wav.half()
        except:
            pass  # Fallback to float32 if half precision not supported

    # Load audio
    print(f"Loading: {input_path.name}")
    wav = AudioFile(str(input_path)).read(
        streams=0,
        samplerate=model.samplerate,
        channels=model.audio_channels,
    ).to(device)

    # Split with speed + quality
    print("Splitting stems... (fast + clean)")
    with torch.no_grad():  # Disable gradient computation for inference speed
        sources = apply_model(
            model,
            wav[None],
            device=device,
            progress=progress,
            overlap=0.05,     # Reduced overlap for speed (minimal quality impact)
            segment=8,        # Slightly smaller segments for faster processing
        )[0]

    # Stem mapping
    stem_tags = {
        "drums": "drums",
        "bass": "bass",
        "other": "melody",
        "vocals": "vocals",
    }
    output_paths = []
    samplerate = model.samplerate
    
    # Pre-process all stems in memory (faster than disk I/O)
    stems_dict = {tag: sources[i].mean(0).cpu().numpy() for i, (src_name, tag) in enumerate(stem_tags.items())}

    # Align all stems to the same length as the full mix
    full_length = wav.shape[-1]
    for tag in stems_dict:
        stem = stems_dict[tag]
        if len(stem) < full_length:
            stem = np.pad(stem, (0, full_length - len(stem)))
        elif len(stem) > full_length:
            stem = stem[:full_length]
        stems_dict[tag] = stem

    # Update status to "splitting" (if not already set)
    if status_file:
        # Ensure status_file is a Path object
        if isinstance(status_file, str):
            status_file = Path(status_file)
        # Only set status if it's not already "splitting" (pipeline.py sets it)
        try:
            current_status = status_file.read_text().strip() if status_file.exists() else ""
            if current_status != "splitting":
                status_file.write_text("splitting")
        except:
            pass
    
    # Process stems with optimizations
    for tag, stem in stems_dict.items():
        # === BASS: 200Hz low-pass ===
        if tag == "bass":
            print("Tuning bass: 200Hz low-pass...")
            stem = lowpass_filter(stem, cutoff=200, fs=samplerate, order=6)

        # === MELODY: Clean bleed (using in-memory stems) ===
        if tag == "melody":
            print("Cleaning melody: removing vocal/drum bleed...")
            vocals = stems_dict.get("vocals")
            drums = stems_dict.get("drums")
            if vocals is not None and drums is not None:
                ref = vocals + drums
                stem_clean = spectral_gate(stem, ref, samplerate, threshold=0.12)
                if len(stem_clean) < len(stem):
                    stem_clean = np.pad(stem_clean, (0, len(stem) - len(stem_clean)))
                if np.max(np.abs(stem_clean)) < 0.05:
                    print("Melody too quiet after cleaning, blending in other stems for fullness...")
                    blend = 0.25 * vocals + 0.25 * drums + 0.25 * stems_dict.get("bass", 0)
                    if len(blend) != len(stem_clean):
                        min_len = min(len(blend), len(stem_clean))
                        blend = blend[:min_len]
                        stem_clean = stem_clean[:min_len]
                    stem_clean = stem_clean + blend
                stem = stem_clean

        # Write to disk
        stem_path = output_dir / f"{base_name}[{tag}].wav"
        sf.write(str(stem_path), stem, samplerate)
        print(f"Saved: {stem_path.name}")
        output_paths.append(str(stem_path))

    # === FULL MIX ===
    if include_full:
        full_path = output_dir / f"{base_name}[full].mp3"
        full_wav = wav.mean(0).cpu().numpy()
        temp_wav = str(full_path).replace(".mp3", ".wav")
        sf.write(temp_wav, full_wav, samplerate)
        try:
            from pydub import AudioSegment
            audio = AudioSegment.from_wav(temp_wav)
            audio.export(str(full_path), format="mp3", bitrate="192k")
            os.remove(temp_wav)
        except Exception as e:
            print(f"MP3 export failed (keeping WAV): {e}")
            full_path = Path(temp_wav)
        print(f"Saved: {full_path.name}")
        output_paths.append(str(full_path))

    # === BPM DETECTION & EMBED (using in-memory drums) ===
    bpm = 128.0
    if "drums" in stems_dict:
        print("Detecting BPM from drums...")
        drums_data = stems_dict["drums"]
        bpm = detect_bpm_from_array(drums_data, samplerate)
        print(f"Detected BPM: {bpm:.1f}")

    # === KEY DETECTION (using melody or full mix) ===
    key = "Unknown"
    if "melody" in stems_dict:
        print("Detecting key from melody...")
        melody_data = stems_dict["melody"]
        key = detect_key_from_audio(melody_data, samplerate)
        print(f"Detected Key: {key}")
    elif include_full:
        # Fallback to full mix if melody not available
        print("Detecting key from full mix...")
        full_data = wav.mean(0).cpu().numpy()
        key = detect_key_from_audio(full_data, samplerate)
        print(f"Detected Key: {key}")

    # Embed BPM in all WAVs
    for path in output_paths:
        if str(path).endswith(".wav"):
            embed_bpm_in_wav(str(path), bpm)
    
    print(f"\nAll stems saved to: {output_dir}")
    print("Drag into Ableton → INSTANT SYNC")
    
    # Return BPM and key for metadata
    return output_paths, bpm, key


# === CLI ===
if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", default="stems")
    args = parser.parse_args()
    stems, bpm, key = split_mp3_to_stems(args.input, args.output)
    print(f"BPM: {bpm:.1f}, Key: {key}")