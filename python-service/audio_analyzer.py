"""PCM / WAV analysis — librosa when available, numpy fallback."""
from __future__ import annotations

import math
import hashlib
from typing import Any, Dict, List, Optional, Tuple  # noqa: F401 — Optional used by analyze_wav_bytes

import numpy as np

from acoustic_features import acoustic_to_legacy_features, extract_acoustic_features
from analysis_export import build_mode_b_export
from brush_mapper import build_unified_brush_package
from feature_normalizer import clamp01, normalize_features
from visual_mapper import features_to_modifiers, modifiers_to_brush

try:
    import librosa

    HAS_LIBROSA = True
except ImportError:  # pragma: no cover
    librosa = None
    HAS_LIBROSA = False


def pcm16_to_float(samples: List[int]) -> np.ndarray:
    if not samples:
        return np.zeros(1, dtype=np.float32)
    arr = np.asarray(samples, dtype=np.float32)
    return np.clip(arr / 32768.0, -1.0, 1.0)


def _band_energy(magnitudes: np.ndarray, start: float, end: float) -> float:
    n = len(magnitudes)
    if n < 2:
        return 0.0
    i0 = int(start * n)
    i1 = max(i0 + 1, int(end * n))
    return float(np.mean(magnitudes[i0:i1]))


def _soft_compress(value: float, knee: float = 0.22) -> float:
    x = max(0.0, float(value) if math.isfinite(float(value)) else 0.0)
    return clamp01(x / (x + knee))


def _finite_mean(values: np.ndarray, default: float = 0.0) -> float:
    if values.size == 0:
        return default
    v = float(np.nanmean(values))
    return v if math.isfinite(v) else default


def _stable_audio_seed(y: np.ndarray, features: Dict[str, float]) -> int:
    if len(y) == 0:
        payload = b"empty"
    else:
        step = max(1, len(y) // 4096)
        quantized = np.clip(y[::step], -1, 1)
        payload = (quantized * 32767).astype(np.int16).tobytes()
    feat_bytes = "|".join(f"{k}:{float(features.get(k, 0.0)):.5f}" for k in sorted(features)).encode("utf-8")
    digest = hashlib.sha256(payload + feat_bytes).digest()
    return int.from_bytes(digest[:4], "little")


def _shape_profile_from_array(y: np.ndarray, sr: int, features: Optional[Dict[str, Any]] = None) -> Dict[str, float]:
    """Continuous shape tendency from real acoustic descriptors, no random template choice."""
    features = features or {}
    y = np.asarray(y, dtype=np.float32).reshape(-1)
    if len(y) < 64:
        return {
            "plume": 0.0, "ribbon": 0.0, "ring": 0.0, "burst": 0.0, "cluster": 0.0,
            "stretchX": 1.0, "stretchY": 1.0, "stretchZ": 1.0,
            "taper": 0.0, "twist": 0.0, "branchiness": 0.0, "fragmentation": 0.0,
            "roughness": 0.0, "density": 0.35, "noiseScale": 0.35, "seed": 0,
        }

    rms = float(np.sqrt(np.mean(y ** 2)))
    peak = float(np.max(np.abs(y)))
    volume = clamp01(rms / 0.35)
    dynamic_range = clamp01((20 * math.log10((peak + 1e-9) / (rms + 1e-9))) / 40) if rms > 1e-7 else 0.0

    if HAS_LIBROSA and len(y) >= 256:
        n_fft = 2048 if len(y) >= 2048 else 512
        hop = max(128, n_fft // 4)
        S = np.abs(librosa.stft(y, n_fft=n_fft, hop_length=hop, center=True))
        power = S ** 2
        freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft)
        nyquist = max(1.0, sr * 0.5)

        centroid = clamp01(_finite_mean(librosa.feature.spectral_centroid(S=S, sr=sr)) / nyquist)
        bandwidth = clamp01(_finite_mean(librosa.feature.spectral_bandwidth(S=S, sr=sr)) / nyquist)
        rolloff = clamp01(_finite_mean(librosa.feature.spectral_rolloff(S=S, sr=sr, roll_percent=0.85)) / nyquist)
        flatness = clamp01(_finite_mean(librosa.feature.spectral_flatness(S=S)) * 3.5)
        zcr = clamp01(_finite_mean(librosa.feature.zero_crossing_rate(y, frame_length=n_fft, hop_length=hop)) / 0.18)
        onset_env = librosa.onset.onset_strength(S=librosa.power_to_db(power + 1e-12), sr=sr, hop_length=hop)
        onset = _soft_compress(_finite_mean(onset_env), 0.16)
        transient = _soft_compress(float(np.percentile(onset_env, 90)) if onset_env.size else 0.0, 0.28)

        norm_frames = S / (np.sum(S, axis=0, keepdims=True) + 1e-9)
        flux_arr = np.sum(np.maximum(np.diff(norm_frames, axis=1, prepend=norm_frames[:, :1]), 0.0), axis=0)
        spectral_flux = _soft_compress(_finite_mean(flux_arr), 0.08)

        rms_frames = librosa.feature.rms(S=S, frame_length=n_fft)[0]
        continuity = 1.0 - clamp01(float(np.std(np.diff(rms_frames))) / (float(np.mean(rms_frames)) + 1e-6))

        # Periodicity from onset autocorrelation plus pitch stability when available.
        periodicity = 0.0
        if onset_env.size >= 8:
          centered = onset_env - np.mean(onset_env)
          corr = np.correlate(centered, centered, mode="full")[len(centered)-1:]
          if corr[0] > 1e-9 and len(corr) > 4:
              lo = max(2, int(round(0.08 * sr / hop)))
              hi = min(len(corr), int(round(1.2 * sr / hop)))
              periodicity = clamp01(float(np.max(corr[lo:hi]) / corr[0]) if hi > lo else 0.0)
        try:
            f0 = librosa.yin(y, fmin=50, fmax=2000, sr=sr)
            valid = f0[np.isfinite(f0)]
            if valid.size > 4:
                pitch_stability = 1.0 - clamp01(float(np.std(valid) / (np.mean(valid) + 1e-9)))
                periodicity = clamp01(periodicity * 0.65 + pitch_stability * 0.35)
        except Exception:
            pass

        total = np.sum(power, axis=0) + 1e-9
        def band_ratio(low_hz: float, high_hz: float) -> float:
            mask = (freqs >= low_hz) & (freqs < high_hz)
            if not np.any(mask):
                return 0.0
            return clamp01(float(np.mean(np.sum(power[mask], axis=0) / total)))

        bass = band_ratio(20, 250)
        mid = band_ratio(250, 4000)
        treble = band_ratio(4000, nyquist + 1)
    else:
        n_fft = min(1024, 1 << int(math.log2(max(64, len(y)))))
        spec = np.abs(np.fft.rfft(y[:n_fft] * np.hanning(min(n_fft, len(y)))))
        freqs = np.fft.rfftfreq(n_fft, 1 / max(1, sr))
        total = float(np.sum(spec) + 1e-9)
        nyquist = max(1.0, sr * 0.5)
        centroid = clamp01(float(np.sum(spec * freqs) / total) / nyquist)
        spread = np.sqrt(np.sum(spec * ((freqs / nyquist) - centroid) ** 2) / total)
        bandwidth = clamp01(float(spread))
        csum = np.cumsum(spec)
        rolloff_idx = int(np.searchsorted(csum, csum[-1] * 0.85)) if csum.size else 0
        rolloff = clamp01(float(freqs[min(rolloff_idx, len(freqs) - 1)] / nyquist))
        flatness = clamp01(float(np.exp(np.mean(np.log(spec + 1e-9))) / (np.mean(spec) + 1e-9)) * 3.5)
        zcr = clamp01(float(np.mean(np.abs(np.diff(np.signbit(y).astype(int))))) / 0.18)
        frame = max(256, min(1024, len(y) // 8))
        hop = max(64, frame // 2)
        env = np.array([np.sqrt(np.mean(y[i:i+frame] ** 2)) for i in range(0, max(1, len(y) - frame), hop)])
        onset_arr = np.maximum(np.diff(env, prepend=env[:1]), 0.0)
        onset = _soft_compress(_finite_mean(onset_arr), 0.08)
        transient = _soft_compress(float(np.percentile(onset_arr, 90)) if onset_arr.size else 0.0, 0.14)
        spectral_flux = onset
        continuity = 1.0 - clamp01(float(np.std(np.diff(env))) / (float(np.mean(env)) + 1e-6)) if env.size > 2 else 0.0
        periodicity = 0.0
        if env.size >= 8:
            centered = env - np.mean(env)
            corr = np.correlate(centered, centered, mode="full")[len(centered)-1:]
            if corr[0] > 1e-9 and len(corr) > 4:
                periodicity = clamp01(float(np.max(corr[2:]) / corr[0]))
        bass = clamp01(float(np.sum(spec[freqs < 250]) / total))
        mid = clamp01(float(np.sum(spec[(freqs >= 250) & (freqs < 4000)]) / total))
        treble = clamp01(float(np.sum(spec[freqs >= 4000]) / total))

    roughness = clamp01(zcr * 0.32 + bandwidth * 0.26 + flatness * 0.24 + dynamic_range * 0.18)
    high_identity = clamp01(centroid * 0.42 + rolloff * 0.26 + treble * 0.32)
    low_weight = clamp01(bass * 1.55)
    flow = clamp01(continuity * 0.72 + (1.0 - transient) * 0.28)
    impulse = clamp01(transient * 0.42 + spectral_flux * 0.38 + dynamic_range * 0.20)
    complex_noise = clamp01(bandwidth * 0.34 + flatness * 0.38 + roughness * 0.28)

    plume = clamp01(high_identity * 0.52 + treble * 0.20 + (1.0 - flatness) * 0.12 + continuity * 0.10 - bass * 0.18)
    ribbon = clamp01(flow * 0.45 + mid * 0.20 + flatness * 0.16 + (1.0 - impulse) * 0.14 + low_weight * 0.08)
    ring = clamp01(periodicity * 0.55 + low_weight * 0.22 + continuity * 0.16 + (1.0 - impulse) * 0.08)
    burst = clamp01(impulse * 0.64 + spectral_flux * 0.18 + dynamic_range * 0.16)
    cluster = clamp01(periodicity * 0.34 + roughness * 0.18 + onset * 0.18 + mid * 0.16 + (1.0 - continuity) * 0.14)

    seed_features = {
        "centroid": centroid, "bandwidth": bandwidth, "rolloff": rolloff,
        "flatness": flatness, "flux": spectral_flux, "onset": onset,
        "periodicity": periodicity, "continuity": continuity, "roughness": roughness,
        "bass": bass, "mid": mid, "treble": treble,
    }
    seed = _stable_audio_seed(y, seed_features)

    return {
        "plume": plume,
        "ribbon": ribbon,
        "ring": ring,
        "burst": burst,
        "cluster": cluster,
        "stretchX": clamp01(0.38 + ribbon * 0.42 + burst * 0.16 + low_weight * 0.22),
        "stretchY": clamp01(0.34 + plume * 0.52 + burst * 0.16 + treble * 0.18),
        "stretchZ": clamp01(0.36 + ring * 0.26 + cluster * 0.24 + low_weight * 0.24),
        "taper": clamp01(high_identity * 0.46 + plume * 0.36 + treble * 0.18),
        "twist": clamp01(ribbon * 0.38 + periodicity * 0.26 + centroid * 0.22 + spectral_flux * 0.14),
        "branchiness": clamp01(plume * 0.42 + treble * 0.24 + centroid * 0.18 + roughness * 0.16),
        "fragmentation": clamp01(burst * 0.52 + spectral_flux * 0.24 + flatness * 0.18 + (1.0 - continuity) * 0.18),
        "roughness": complex_noise,
        "density": clamp01(0.22 + volume * 0.26 + cluster * 0.22 + continuity * 0.12 + mid * 0.18),
        "noiseScale": clamp01(0.18 + complex_noise * 0.62 + spectral_flux * 0.20),
        "seed": float(seed),
    }


def analyze_pcm_frame(samples: List[int], sample_rate: int = 16000) -> Dict[str, Any]:
    y = pcm16_to_float(samples)
    if len(y) < 8:
        return normalize_features({})

    rms = float(np.sqrt(np.mean(y ** 2)))
    peak = float(np.max(np.abs(y)))
    volume = clamp01(rms / 0.22)
    energy = clamp01(volume * 0.7 + peak * 0.3)

    zc = np.sum(np.abs(np.diff(np.signbit(y).astype(int)))) / max(1, len(y) - 1)
    zcr = clamp01(zc / 0.12)
    roughness = clamp01(zcr * 0.65 + (peak - rms) * 0.35)

    # Lightweight FFT
    n_fft = min(1024, 1 << int(math.log2(max(64, len(y)))))
    windowed = y[:n_fft] * np.hanning(len(y[:n_fft]))
    spec = np.abs(np.fft.rfft(windowed))
    spec_norm = np.asarray([_soft_compress(float(v), 0.035) for v in spec], dtype=np.float32)

    bass = clamp01(_band_energy(spec_norm, 0.0, 0.12))
    mid = clamp01(_band_energy(spec_norm, 0.12, 0.45))
    treble = clamp01(_band_energy(spec_norm, 0.45, 1.0))
    brightness = clamp01(_band_energy(spec_norm, 0.35, 0.95))
    spectral_centroid = brightness

    profile = [_soft_compress(float(v), 0.035) for v in spec[:128].tolist()]

    pitch = 0.0
    if HAS_LIBROSA and len(y) >= 256:
        try:
            f0 = librosa.yin(y, fmin=50, fmax=2000, sr=sample_rate)
            pitch = clamp01((float(np.nanmedian(f0)) - 50) / 1950)
        except Exception:
            pitch = clamp01(mid * 0.4 + treble * 0.3)

    dynamic_range = clamp01((20 * math.log10((peak + 1e-9) / (rms + 1e-9))) / 40) if rms > 1e-6 else 0.0

    return normalize_features({
        "volume": volume,
        "energy": energy,
        "brightness": brightness,
        "roughness": roughness,
        "pitch": pitch,
        "tempo": clamp01(roughness * 0.6 + energy * 0.4),
        "spectralCentroid": spectral_centroid,
        "zcr": zcr,
        "dynamicRange": dynamic_range,
        "spectralVariation": clamp01(roughness * 0.55 + treble * 0.25),
        "bass": bass,
        "mid": mid,
        "treble": treble,
        "spectrumProfile": profile,
    })


def analyze_wav_bytes(
    data: bytes,
    sample_rate_hint: int = 16000,
    *,
    category: Optional[str] = None,
) -> Tuple[Dict[str, Any], Dict[str, Any], Dict[str, Any], Dict[str, Any], Dict[str, Any]]:
    """Mode B: acoustic features → brush; category (from Qwen) sets strokePattern."""
    y: np.ndarray
    sr = sample_rate_hint

    if HAS_LIBROSA:
        import io
        import soundfile as sf

        y, sr = sf.read(io.BytesIO(data), dtype="float32", always_2d=False)
        if y.ndim > 1:
            y = np.mean(y, axis=1)
    else:
        y, sr = _decode_wav_pcm16_mono(data, sample_rate_hint)

    acoustic = _acoustic_from_array(y, sr)
    acoustic_feats = extract_acoustic_features(y, sr)
    package = build_unified_brush_package(category, acoustic_feats)
    brush = package["brushParams"]
    mods = package["visualModifiers"]
    # Prefer acoustic-derived legacy features; keep spectrum profile from librosa path when available
    feats = acoustic_to_legacy_features(acoustic_feats)
    if HAS_LIBROSA and len(y) >= 256:
        legacy = _analyze_with_librosa(y, sr)
        feats["spectrumProfile"] = legacy.get("spectrumProfile") or []
        # Keep brightness/pitch nuance from librosa without re-classifying
        feats["brightness"] = legacy.get("brightness", feats["brightness"])
        feats["pitch"] = legacy.get("pitch", feats["pitch"])

    export = build_mode_b_export(
        y,
        sr,
        feats,
        acoustic,
        acoustic_features=acoustic_feats,
        category=package.get("category"),
        stroke_pattern=package.get("strokePattern"),
        visual_structure=package.get("visualStructure"),
        brush_params=brush,
    )
    export["unifiedBrush"] = {
        "category": package.get("category"),
        "strokePattern": package.get("strokePattern"),
        "acousticFeatures": package.get("acousticFeatures"),
        "brushParams": brush,
    }
    return feats, mods, brush, acoustic, export


def _analyze_with_librosa(y: np.ndarray, sr: int) -> Dict[str, Any]:
    rms = float(np.sqrt(np.mean(y ** 2)))
    peak = float(np.max(np.abs(y)))
    volume = clamp01(rms / 0.22)
    zcr = clamp01(float(np.mean(librosa.feature.zero_crossing_rate(y))) / 0.12)
    centroid = clamp01(float(np.mean(librosa.feature.spectral_centroid(y=y, sr=sr))) / (sr * 0.5))
    rolloff = clamp01(float(np.mean(librosa.feature.spectral_rolloff(y=y, sr=sr))) / (sr * 0.5))
    bandwidth = clamp01(float(np.mean(librosa.feature.spectral_bandwidth(y=y, sr=sr))) / (sr * 0.5))

    S = np.abs(librosa.stft(y, n_fft=2048, hop_length=512))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=2048)
    power = np.mean(S ** 2, axis=1)
    total = float(np.sum(power) + 1e-9)
    bass = clamp01(float(np.sum(power[freqs < 250]) / total))
    mid = clamp01(float(np.sum(power[(freqs >= 250) & (freqs < 2000)]) / total))
    treble = clamp01(float(np.sum(power[freqs >= 2000]) / total))

    try:
        tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
        tempo_n = clamp01(float(tempo) / 180.0)
    except Exception:
        tempo_n = clamp01(volume * 0.4)

    try:
        f0 = librosa.yin(y, fmin=50, fmax=2000, sr=sr)
        pitch = clamp01((float(np.nanmedian(f0)) - 50) / 1950)
    except Exception:
        pitch = clamp01(centroid * 0.6)

    profile = power[:128]
    profile_list = [_soft_compress(float(v), 0.004) for v in profile.tolist()]

    roughness = clamp01(zcr * 0.5 + bandwidth * 0.3 + (peak - rms) * 0.2)
    dynamic_range = clamp01((20 * math.log10((peak + 1e-9) / (rms + 1e-9))) / 40) if rms > 1e-6 else 0.0

    return normalize_features({
        "volume": volume,
        "energy": clamp01(volume * 0.55 + bass * 0.25 + treble * 0.2),
        "brightness": clamp01(centroid * 0.6 + rolloff * 0.4),
        "roughness": roughness,
        "pitch": pitch,
        "tempo": tempo_n,
        "spectralCentroid": centroid,
        "zcr": zcr,
        "dynamicRange": dynamic_range,
        "spectralVariation": clamp01(bandwidth * 0.55 + roughness * 0.45),
        "bass": bass,
        "mid": mid,
        "treble": treble,
        "spectrumProfile": profile_list,
    })


def _acoustic_from_array(y: np.ndarray, sr: int) -> Dict[str, Any]:
    duration = float(len(y) / max(1, sr))
    step = max(1, len(y) // 800)
    waveform = [float(v) for v in y[::step][:800]]

    spectrum: List[float] = []
    spectrogram: List[List[float]] = []
    frame_features: List[Dict[str, float]] = []

    if HAS_LIBROSA and len(y) >= 256:
        S = np.abs(librosa.stft(y, n_fft=2048, hop_length=512))
        S_db = librosa.amplitude_to_db(np.maximum(S, 1e-9), ref=1.0)
        spec_mean = np.mean(S, axis=1)
        spectrum = [_soft_compress(float(v), 0.035) for v in spec_mean.tolist()[:256]]
        hop = max(1, S_db.shape[1] // 120)
        band = max(1, S_db.shape[0] // 96)
        spectrogram = [
            [clamp01((float(v) + 80) / 80) for v in row]
            for row in S_db[::band, ::hop][:, :120]
        ]
        freqs = librosa.fft_frequencies(sr=sr, n_fft=2048)
        power = S ** 2
        total = np.sum(power, axis=0) + 1e-9
        rms = librosa.feature.rms(S=S)[0]
        centroid = librosa.feature.spectral_centroid(S=S, sr=sr)[0] / max(1.0, sr * 0.5)
        bandwidth = librosa.feature.spectral_bandwidth(S=S, sr=sr)[0] / max(1.0, sr * 0.5)
        onset = librosa.onset.onset_strength(S=librosa.power_to_db(power + 1e-12), sr=sr, hop_length=512)
        norm_frames = S / (np.sum(S, axis=0, keepdims=True) + 1e-9)
        flux = np.sum(np.maximum(np.diff(norm_frames, axis=1, prepend=norm_frames[:, :1]), 0.0), axis=0)

        def band_ratio(low_hz: float, high_hz: float) -> np.ndarray:
            mask = (freqs >= low_hz) & (freqs < high_hz)
            if not np.any(mask):
                return np.zeros(S.shape[1], dtype=np.float32)
            return np.sum(power[mask], axis=0) / total

        bass = band_ratio(20, 250)
        low_mid = band_ratio(250, 1000)
        mid = band_ratio(1000, 4000)
        treble = band_ratio(4000, sr * 0.5 + 1)
        count = min(len(rms), len(centroid), len(bandwidth), len(onset), len(flux), len(bass))
        step_frames = max(1, count // 240)
        for idx in range(0, count, step_frames):
            frame_features.append({
                "time": float(librosa.frames_to_time(idx, sr=sr, hop_length=512)),
                "rms": _soft_compress(float(rms[idx]), 0.18),
                "centroid": clamp01(float(centroid[idx])),
                "bandwidth": clamp01(float(bandwidth[idx])),
                "onset": _soft_compress(float(onset[idx]), 0.12),
                "flux": _soft_compress(float(flux[idx]), 0.08),
                "bass": clamp01(float(bass[idx])),
                "lowMid": clamp01(float(low_mid[idx])),
                "mid": clamp01(float(mid[idx])),
                "treble": clamp01(float(treble[idx])),
            })
    else:
        n_fft = min(1024, 1 << int(math.log2(max(64, len(y)))))
        spec = np.abs(np.fft.rfft(y[:n_fft] * np.hanning(min(n_fft, len(y)))))
        spectrum = [_soft_compress(float(v), 0.035) for v in spec[:128].tolist()]

    return {
        "waveform": waveform,
        "spectrogram": spectrogram,
        "spectrum": spectrum,
        "frameFeatures": frame_features,
        "shapeProfile": _shape_profile_from_array(y, sr),
        "sampleRate": sr,
        "duration": duration,
    }


def _decode_wav_pcm16_mono(data: bytes, default_sr: int) -> Tuple[np.ndarray, int]:
    if len(data) < 44 or data[0:4] != b"RIFF":
        return np.zeros(1, dtype=np.float32), default_sr
    sr = int.from_bytes(data[24:28], "little")
    bits = int.from_bytes(data[34:36], "little")
    offset = 36
    while offset + 8 <= len(data):
        cid = data[offset : offset + 4]
        size = int.from_bytes(data[offset + 4 : offset + 8], "little")
        if cid == b"data":
            raw = data[offset + 8 : offset + 8 + size]
            if bits == 16:
                arr = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
                return arr, sr
            break
        offset += 8 + size
    return np.zeros(1, dtype=np.float32), default_sr
