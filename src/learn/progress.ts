import { ALL_SPOTS, PLACES } from "../content/places";

const STORAGE_KEY = "da-world.progress.v1";

interface ProgressState {
  /** spot id -> epoch ms of first visit. */
  learned: Record<string, number>;
  /** place id -> best quiz score (0..1). */
  quizzes: Record<string, number>;
}

type Listener = (progress: Progress) => void;

function emptyState(): ProgressState {
  return { learned: {}, quizzes: {} };
}

function load(): ProgressState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as Partial<ProgressState>;
    return {
      learned: parsed.learned ?? {},
      quizzes: parsed.quizzes ?? {},
    };
  } catch {
    return emptyState();
  }
}

/** Player progress, persisted to localStorage and observable by the UI. */
export class Progress {
  private state = load();
  private readonly listeners: Listener[] = [];

  readonly total = ALL_SPOTS.length;

  get learnedCount(): number {
    return Object.keys(this.state.learned).length;
  }

  isLearned(spotId: string): boolean {
    return spotId in this.state.learned;
  }

  /** Returns true if this was the first time. */
  markLearned(spotId: string): boolean {
    if (this.isLearned(spotId)) return false;
    this.state.learned[spotId] = Date.now();
    this.save();
    return true;
  }

  placeProgress(placeId: string): { learned: number; total: number } {
    const place = PLACES.find((p) => p.id === placeId);
    if (!place) return { learned: 0, total: 0 };
    const learned = place.spots.filter((s) => this.isLearned(s.id)).length;
    return { learned, total: place.spots.length };
  }

  /** True once every word in a place has been visited. */
  isPlaceComplete(placeId: string): boolean {
    const { learned, total } = this.placeProgress(placeId);
    return total > 0 && learned === total;
  }

  quizScore(placeId: string): number {
    return this.state.quizzes[placeId] ?? 0;
  }

  recordQuiz(placeId: string, score: number): void {
    if (score > this.quizScore(placeId)) {
      this.state.quizzes[placeId] = score;
      this.save();
    }
  }

  reset(): void {
    this.state = emptyState();
    this.save();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.push(listener);
    listener(this);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) this.listeners.splice(index, 1);
    };
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // Private browsing or storage full — progress just won't persist.
    }
    for (const listener of this.listeners) listener(this);
  }
}
