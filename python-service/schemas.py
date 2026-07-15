"""Pydantic schemas — unified feature / visual / brush contracts."""
from __future__ import annotations

from typing import Dict, List, Optional

from pydantic import BaseModel, Field


class AudioFeatures(BaseModel):
    volume: float = 0.0
    energy: float = 0.0
    brightness: float = 0.0
    roughness: float = 0.0
    pitch: float = 0.0
    tempo: float = 0.0
    spectralCentroid: float = 0.0
    zcr: float = 0.0
    dynamicRange: float = 0.0
    spectralVariation: float = 0.0
    bass: float = 0.0
    mid: float = 0.0
    treble: float = 0.0
    spectrumProfile: List[float] = Field(default_factory=list)


class VisualModifiers(BaseModel):
    motionIntensity: float = 0.0
    turbulence: float = 0.0
    strokeComplexity: float = 0.0
    particleDensity: float = 0.0
    smoothness: float = 0.0
    organicFactor: float = 0.0
    flowSpeed: float = 0.0
    spread: float = 0.0
    continuity: float = 0.0
    pulseStrength: float = 0.0
    rotationSpeed: float = 0.0
    scaleResponse: float = 0.0


class BrushParams(BaseModel):
    strokeWidth: float = 0.0
    flow: float = 0.0
    density: float = 0.0
    turbulence: float = 0.0
    motion: float = 0.0
    continuity: float = 0.0
    particleDensity: float = 0.0
    rotationSpeed: float = 0.0
    smoothness: float = 0.0
    styleModifiers: dict = Field(default_factory=dict)


class AudioFrameMessage(BaseModel):
    type: str = "audio_frame"
    timestamp: int = 0
    sampleRate: int = 16000
    channels: int = 1
    format: str = "pcm_s16le"
    sequence: int = 0
    samples: List[int] = Field(default_factory=list)


class AnalysisResultMessage(BaseModel):
    type: str = "analysis_result"
    timestamp: int = 0
    sequence: int = 0
    features: AudioFeatures = Field(default_factory=AudioFeatures)
    visualModifiers: VisualModifiers = Field(default_factory=VisualModifiers)
    brushParams: Optional[BrushParams] = None


class AcousticVisualization(BaseModel):
    """Waveform / spectrogram / spectrum — Python librosa visual structure."""
    waveform: List[float] = Field(default_factory=list)
    spectrogram: List[List[float]] = Field(default_factory=list)
    spectrum: List[float] = Field(default_factory=list)
    frameFeatures: List[dict] = Field(default_factory=list)
    shapeProfile: Dict[str, float] = Field(default_factory=dict)
    sampleRate: int = 16000
    duration: float = 0.0


class SemanticAnalysis(BaseModel):
    """Open-ended Qwen3-Omni audio understanding (optional)."""
    soundLabel: str = ""
    description: str = ""
    possibleSources: List[str] = Field(default_factory=list)
    audibleEvents: List[str] = Field(default_factory=list)
    confidence: float = 0.0
    model: Optional[str] = None
    provider: Optional[str] = None


class FullAnalysisResponse(BaseModel):
    features: AudioFeatures
    visualModifiers: VisualModifiers
    brushParams: BrushParams
    acoustic: AcousticVisualization
    analysisExport: dict = Field(default_factory=dict)
    duration: float = 0.0
    semantic: Optional[SemanticAnalysis] = None
