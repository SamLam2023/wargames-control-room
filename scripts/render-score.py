#!/usr/bin/env python3
"""Render the original Control Room suite with sampled acoustic instruments.

Needs libfluidsynth and GeneralUser GS 2.0.3 (see assets/music/credits.txt).
Run: uv run --with numpy --with soundfile python scripts/render-score.py /path/to/GeneralUser-GS.sf2
The browser/build has no Python, MIDI engine or SoundFont dependency.
"""
import ctypes as C
import ctypes.util
import json
from pathlib import Path
import sys

import numpy as np
import soundfile as sf

RATE = 44100
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/music'
(ROOT / 'output').mkdir(exist_ok=True)
LIB = C.CDLL(ctypes.util.find_library('fluidsynth'))


def bind(name, result, *args):
    fn = getattr(LIB, name)
    fn.restype, fn.argtypes = result, args
    return fn


ptr, integer, real, string = C.c_void_p, C.c_int, C.c_double, C.c_char_p
settings_new = bind('new_fluid_settings', ptr)
settings_num = bind('fluid_settings_setnum', integer, ptr, string, real)
settings_int = bind('fluid_settings_setint', integer, ptr, string, integer)
synth_new = bind('new_fluid_synth', ptr, ptr)
load = bind('fluid_synth_sfload', integer, ptr, string, integer)
program = bind('fluid_synth_program_select', integer, ptr, integer, integer, integer, integer)
cc = bind('fluid_synth_cc', integer, ptr, integer, integer, integer)
on = bind('fluid_synth_noteon', integer, ptr, integer, integer, integer)
off = bind('fluid_synth_noteoff', integer, ptr, integer, integer)
write = bind('fluid_synth_write_float', integer, ptr, integer, ptr, integer, integer, ptr, integer, integer)
delete_synth = bind('delete_fluid_synth', None, ptr)
delete_settings = bind('delete_fluid_settings', None, ptr)

# D minor to A dominant. Close, gently shifting voicings keep the ostinato
# grounded; the same motif gains new orchestration and rhythm as danger rises.
HARMONY = [
    (38, [57, 62, 65, 69]), (36, [57, 62, 65, 69]),
    (34, [58, 62, 65, 69]), (31, [55, 58, 62, 67]),
    (33, [57, 62, 65, 69]), (34, [58, 62, 65, 70]),
    (31, [55, 58, 62, 67]), (33, [57, 61, 64, 67]),
]
THEME = [
    [(0, 74, 1.35), (1.5, 76, .4), (2, 77, 1.5)],
    [(0, 76, .7), (1, 74, .8), (2.5, 69, 1.1)],
    [(0, 70, 1.4), (1.5, 74, .4), (2, 77, 1.5)],
    [(0, 79, .9), (1.5, 77, .4), (2, 74, 1.6)],
    [(0, 77, 1.3), (1.5, 76, .4), (2, 74, 1.5)],
    [(0, 70, .7), (1, 72, .7), (2, 74, 1.6)],
    [(0, 70, 1.3), (1.5, 69, .4), (2, 67, 1.6)],
    [(0, 73, 1.3), (1.5, 76, .4), (2, 73, 1.4)],
]


def compose(kind):
    events = []
    rng = np.random.default_rng(1983)

    def note(ch, beat, pitch, duration, velocity):
        # Slightly staggered players, with exact downbeats for a loopable score.
        start = max(0, beat + float(rng.uniform(0, .012)))
        vel = int(np.clip(velocity + rng.integers(-3, 4), 1, 120))
        events.extend([(start, 1, ch, pitch, vel), (start + duration, 0, ch, pitch, 0)])

    if kind == 'resolution':
        # Open D major, without the urgent ostinato. An answering woodwind
        # phrase and harp arpeggios bring the same story to a quiet conclusion.
        peace = [(38,[57,62,66,69]), (35,[59,62,66,69]),
                 (31,[55,59,62,67]), (33,[57,61,64,69]),
                 (38,[57,62,66,69]), (30,[54,57,62,66]),
                 (31,[55,59,62,67]), (33,[57,61,64,69])]
        tune = [[(0,74,1.7),(2,78,1.7)], [(0,76,1.2),(1.5,74,2)],
                [(0,71,1.3),(1.5,74,.4),(2,79,1.6)], [(0,76,3.3)],
                [(0,78,1.5),(2,81,1.6)], [(0,78,1.4),(2,74,1.6)],
                [(0,71,1.4),(2,74,1.6)], [(0,73,1.4),(2,69,1.6)]]
        for bar in range(16):
            bass, chord = peace[bar % 8]
            t = bar * 4
            for pitch in chord:
                note(2, t, pitch, 3.9, 39 + (bar >= 8) * 5)
            note(3, t, bass + 12, 3.8, 45)
            for i, pitch in enumerate([chord[0], chord[1], chord[2], chord[3], chord[2], chord[1]]):
                note(7, t + i * .5, pitch + 12, .9, 40 + (i == 0) * 9)
            for b, pitch, duration in tune[bar % 8]:
                note(5 if bar < 8 else 4, t + b, pitch if bar < 8 else pitch - 12, duration, 58)
            if bar in (0, 4, 8, 12):
                note(0, t, chord[1] + 12, 3, 48)
        return 76, events

    crisis = kind == 'crisis'
    intro = kind == 'intro'
    for bar in range(16):
        bass, chord = HARMONY[bar % 8]
        t = bar * 4
        swell = (bar % 8) * 1.2
        # Short acoustic bass/cello and pizzicato: distinct attacks, never a
        # continuous low oscillator or noise bed.
        for b in (0, 2):
            note(8, t + b, bass, .75 if crisis else 1.2, 69 if crisis else 55)
            note(3, t + b, bass + 12, .65 if crisis else 1.4, 57 if crisis else 44)
        pattern = [0, 2, 1, 3, 0, 2, 3, 1]
        for i, position in enumerate(pattern):
            velocity = (68 if crisis else 54 if not intro else 43) + (i % 4 == 0) * 9
            note(1, t + i * .5, chord[position], .20 if crisis else .30, velocity)
            if intro or i % 2 == 0:
                note(0, t + i * .5, chord[position] + 12, .33 if crisis else .55, velocity - 6)
        # Bowed harmony enters in shaped phrases, leaving breathing space.
        for pitch in chord[:3]:
            note(2, t + .05, pitch, 3.65, (43 if crisis else 31 if intro else 36) + swell)
        if crisis:
            for i in range(8):
                note(11, t + i * .5, chord[i % 3] + 12, .19, 55 + (i % 2 == 0) * 8)
            for b, velocity in [(0, 80), (1.5, 53), (2, 66), (3.5, 57)]:
                note(6, t + b, bass + 12, .38, velocity)
            if bar % 4 == 0:
                note(9, t, 36, .5, 70)
                note(10, t, 62 if bar % 8 == 0 else 61, 1.5, 43)
            # A measured crescendo into each dominant; no continuous cymbal hiss.
            if bar % 8 == 7:
                for i in range(4):
                    note(6, t + 3 + i * .25, 45, .17, 52 + i * 7)
        elif bar % 2 == 0 and not intro:
            note(6, t, bass + 12, .8, 52)
        # Original ascending semitone theme. Horns answer the woodwind phrase;
        # in the crisis it moves to broad brass over faster bowed figures.
        if not intro or bar >= 8:
            instrument = 4 if crisis or bar >= 8 else 5
            for b, pitch, duration in THEME[bar % 8]:
                note(instrument, t + b, pitch - (12 if instrument == 4 else 0), duration,
                     (79 if crisis else 60) + swell * .5)
        elif bar % 2 == 0:
            note(5, t + 1, THEME[bar % 8][0][1] - 12, 2.4, 47)
    return (126 if crisis else 100 if not intro else 86), events


def render(kind, font):
    bpm, events = compose(kind)
    frames = round(64 * 60 / bpm * RATE)
    settings = settings_new()
    settings_num(settings, b'synth.sample-rate', RATE)
    settings_num(settings, b'synth.gain', .7)
    settings_num(settings, b'synth.reverb.room-size', .68)
    settings_num(settings, b'synth.reverb.damp', .6)
    settings_num(settings, b'synth.reverb.width', 35)
    settings_num(settings, b'synth.reverb.level', .24)
    settings_int(settings, b'synth.chorus.active', 0)
    settings_int(settings, b'synth.polyphony', 256)
    settings_int(settings, b'synth.cpu-cores', 1)
    synth = synth_new(settings)
    font_id = load(synth, str(font).encode(), 0)
    if font_id < 0:
        raise RuntimeError('Cannot load SoundFont')
    # Acoustic grand, pizzicato strings, ensemble strings, cello, French horn,
    # clarinet, timpani, harp, double bass, orchestral drums, bells, violins.
    instruments = [0, 45, 48, 42, 60, 71, 47, 46, 43, 48, 14, 48]
    pans = [59, 37, 76, 43, 82, 52, 66, 91, 60, 64, 44, 29]
    for channel, patch in enumerate(instruments):
        program(synth, channel, font_id, 128 if channel == 9 else 0, patch)
        cc(synth, channel, 10, pans[channel])
        cc(synth, channel, 7, 100)
        cc(synth, channel, 91, 38 if channel in (2, 4, 5, 11) else 24)
    # A whole warm-up pass supplies the preceding bar's natural release and
    # room tail at the loop boundary. MP3 carries gapless encoder metadata.
    timeline = []
    for repeat in range(2):
        for beat, action, channel, pitch, velocity in events:
            timeline.append((round(beat * 60 / bpm * RATE) + repeat * frames,
                             action, channel, pitch, velocity))
    timeline.sort()
    audio = np.empty((frames * 2, 2), dtype=np.float32)

    def samples(start, end):
        for offset in range(start, end, 4096):
            length = min(4096, end - offset)
            left, right = np.empty(length, np.float32), np.empty(length, np.float32)
            write(synth, length, left.ctypes.data, 0, 1, right.ctypes.data, 0, 1)
            audio[offset:offset + length, 0] = left
            audio[offset:offset + length, 1] = right

    cursor = 0
    for frame, action, channel, pitch, velocity in timeline:
        if frame >= len(audio):
            break
        samples(cursor, frame)
        (on(synth, channel, pitch, velocity) if action else off(synth, channel, pitch))
        cursor = frame
    samples(cursor, len(audio))
    delete_synth(synth)
    delete_settings(settings)
    audio = audio[frames:]
    audio -= audio.mean(axis=0)
    # Gentle peak control retains phrasing and makes quiet speakers useful.
    rms = float(np.sqrt(np.mean(audio ** 2)))
    target_db = {'intro': -19, 'gameplay': -18, 'crisis': -17, 'resolution': -20}[kind]
    audio *= 10 ** (target_db / 20) / rms
    audio = .88 * np.tanh(audio / .88)
    # A tiny raised-cosine seam removes differences from the sampler's random
    # ensemble phases and MP3 edge ringing without an audible pause each loop.
    seam = round(RATE * .008)
    envelope = .5 - .5 * np.cos(np.linspace(0, np.pi, seam))
    audio[:seam] *= envelope[:, None]
    audio[-seam:] *= envelope[::-1, None]
    path = OUT / f'{kind}-v2.mp3'
    sf.write(path, audio, RATE, format='MP3', bitrate_mode='CONSTANT', compression_level=.6)
    decoded, rate = sf.read(path, dtype='float32', always_2d=True)
    stats = {'file': path.name, 'bpm': bpm, 'bars': 16, 'seconds': len(decoded) / rate,
             'bytes': path.stat().st_size, 'peak_dbfs': round(float(20 * np.log10(np.abs(decoded).max())), 2),
             'rms_dbfs': round(float(20 * np.log10(np.sqrt(np.mean(decoded ** 2)))), 2),
             'loop_boundary_step': round(float(np.abs(decoded[-1] - decoded[0]).max()), 6),
             'note_events': len(events) // 2}
    assert np.isfinite(decoded).all() and np.abs(decoded).max() < .99
    assert -26 < stats['rms_dbfs'] < -13
    assert stats['loop_boundary_step'] < .01
    print(json.dumps(stats), flush=True)
    return stats


if __name__ == '__main__':
    OUT.mkdir(exist_ok=True)
    results = [render(kind, Path(sys.argv[1])) for kind in ['intro', 'gameplay', 'crisis', 'resolution']]
    (ROOT / 'output/music-render.json').write_text(json.dumps(results, indent=2) + '\n')
