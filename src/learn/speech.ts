/**
 * Text-to-speech for the English content, via the Web Speech API.
 *
 * No audio files ship with the game — pronunciation comes from the platform
 * voice. If the API is missing the rest of the game still works, the speaker
 * buttons just go quiet.
 */

const PREFERRED = ["en-GB", "en-US", "en-AU", "en"];

export class Speech {
  private voice: SpeechSynthesisVoice | null = null;
  muted = false;

  readonly supported =
    typeof window !== "undefined" && "speechSynthesis" in window;

  constructor() {
    if (!this.supported) return;
    this.pickVoice();
    window.speechSynthesis.addEventListener?.("voiceschanged", this.pickVoice);
  }

  private pickVoice = (): void => {
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return;
    for (const tag of PREFERRED) {
      const match = voices.find((v) => v.lang.replace("_", "-").startsWith(tag));
      if (match) {
        this.voice = match;
        return;
      }
    }
    this.voice = voices[0] ?? null;
  };

  speak(text: string, rate = 0.95): void {
    if (!this.supported || this.muted || !text) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = rate;
    utterance.pitch = 1;
    utterance.lang = this.voice?.lang ?? "en-GB";
    if (this.voice) utterance.voice = this.voice;
    window.speechSynthesis.speak(utterance);
  }

  stop(): void {
    if (this.supported) window.speechSynthesis.cancel();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.muted) this.stop();
    return this.muted;
  }
}
