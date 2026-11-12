// Sound effects shared by both views: tiny Web Audio beeps, no audio files. Browsers only allow audio
// after a user gesture, which clicks and key presses are. Call Sound.onState(state) after every state change.
// Each sound has its own relative volume (vol); the master volume and mute come from the ViewModel.
const Sound = (() => {
  const SOUNDS = {
    reveal: { notes: [[600, 40]], type: 'square', vol: 0.5 },
    flag:   { notes: [[420, 50]], type: 'square', vol: 0.6 },
    undo:   { notes: [[300, 60]], type: 'square', vol: 0.4 },
    boom:   { notes: [[90, 450]], type: 'sawtooth', vol: 1 },
    win:    { notes: [[523, 150], [659, 150], [784, 150]], type: 'square', vol: 0.8 },
  };
  let audioCtx, prev = null; // prev = counts from the last state, used to guess what just happened

  function play(name, s) {
    if (s.muted) return;
    const snd = SOUNDS[name];
    try {
      audioCtx = audioCtx || new AudioContext();
      let t = audioCtx.currentTime;
      for (const [freq, ms] of snd.notes) {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = snd.type; o.frequency.value = freq; g.gain.value = 0.2 * s.volume * snd.vol;
        o.connect(g); g.connect(audioCtx.destination); o.start(t); o.stop(t + ms / 1000);
        t += ms / 1000;
      }
    } catch (e) {}
  }

  function onState(s) {
    const flat = s.cells.flat(), open = flat.filter(c => c.revealed).length, flags = flat.filter(c => c.flagged).length;
    if (prev && prev.gameId === s.gameId) { // a new game (different gameId) is silent
      if (s.status === 'lost' && prev.status !== 'lost') play('boom', s);
      else if (s.status === 'won' && prev.status !== 'won') play('win', s);
      else if (open > prev.open) play('reveal', s);
      else if (open < prev.open) play('undo', s); // undo of a reveal
      else if (flags !== prev.flags) play('flag', s);
    }
    prev = { gameId: s.gameId, open, flags, status: s.status };
  }
  return { onState };
})();
