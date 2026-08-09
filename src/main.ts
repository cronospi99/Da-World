import * as THREE from "three";
import "./styles.css";

import { Engine } from "./core/engine";
import { Input } from "./core/input";
import { PLACES } from "./content/places";
import type { Place } from "./content/types";
import { CameraRig } from "./game/cameraRig";
import { Player } from "./game/player";
import { animateProps, buildPlaces, placeAt } from "./game/placesBuilder";
import { Progress } from "./learn/progress";
import { Speech } from "./learn/speech";
import { Hotspots } from "./ui/hotspots";
import { Hud } from "./ui/hud";
import { LessonCard } from "./ui/lesson";
import { Quiz } from "./ui/quiz";
import { createEnvironment } from "./world/environment";
import { createScatter } from "./world/scatter";
import { createTerrain } from "./world/terrain";

const container = document.querySelector<HTMLElement>("#app");
if (!container) throw new Error("#app container is missing from the document");

const engine = new Engine(container);
const environment = createEnvironment(engine.scene);

engine.scene.add(createTerrain());
engine.scene.add(createScatter());

const world = buildPlaces();
engine.scene.add(world.group);

// The player starts just outside the middle of the first place, facing in.
const start = PLACES[0]?.center ?? [0, 0];
const player = new Player(new THREE.Vector2(start[0], start[1] + 8));
engine.scene.add(player.object);

const rig = new CameraRig(engine.camera);
const input = new Input(engine.canvas);

// --- UI ---------------------------------------------------------------------
const ui = document.createElement("div");
ui.className = "ui-layer";
container.appendChild(ui);

const markerLayer = document.createElement("div");
markerLayer.className = "marker-layer";
ui.appendChild(markerLayer);

const progress = new Progress();
const speech = new Speech();

const lesson = new LessonCard(ui, speech, progress);
const quiz = new Quiz(ui, speech, progress);
const hud = new Hud(ui, speech, progress, {
  onOpenQuiz: (place) => openQuiz(place),
});

const hotspots = new Hotspots(markerLayer, world.targets, engine.camera, progress, (target) =>
  openLesson(target),
);

function modalIsOpen(): boolean {
  return lesson.isOpen || quiz.isOpen || hud.isInfoOpen;
}

function syncInput(): void {
  input.enabled = !modalIsOpen();
  if (!input.enabled) input.move.set(0, 0);
}

function openLesson(target: (typeof world.targets)[number]): void {
  if (modalIsOpen()) return;
  const wasComplete = progress.isPlaceComplete(target.place.id);
  lesson.open(target);
  syncInput();
  // Announce a freshly finished place once the card closes.
  pendingCompletion = wasComplete ? null : target.place;
}

function openQuiz(place: Place): void {
  if (lesson.isOpen || quiz.isOpen) return;
  quiz.open(place);
  syncInput();
}

let pendingCompletion: Place | null = null;

lesson.onClose(() => {
  syncInput();
  if (pendingCompletion && progress.isPlaceComplete(pendingCompletion.id)) {
    hud.showToast(
      `${pendingCompletion.name} complete!`,
      "Tap ✓ to practise these words.",
    );
  }
  pendingCompletion = null;
});

quiz.onClose(() => syncInput());

input.onInteract(() => {
  const target = hotspots.active;
  if (target) openLesson(target);
});

input.onCancel(() => {
  if (lesson.isOpen) lesson.close();
  else if (quiz.isOpen) quiz.close();
  else if (hud.isInfoOpen) hud.toggleInfo(false);
  syncInput();
});

// --- loop -------------------------------------------------------------------
engine.onUpdate((dt, elapsed) => {
  input.update();
  rig.update(dt, input, player.position);
  if (!modalIsOpen()) player.update(dt, input, rig.yaw);

  environment.update(elapsed);
  animateProps(world.animated, elapsed);

  // Keep the sun's shadow frustum centred on the player.
  environment.sun.position.set(
    player.position.x + 60,
    player.position.y + 80,
    player.position.z + 40,
  );
  environment.sun.target.position.copy(player.position);
  environment.sun.target.updateMatrixWorld();

  hotspots.update(player.position);
  hud.setPlace(placeAt(player.position.x, player.position.z));

  const active = hotspots.active;
  hud.setHint(
    modalIsOpen() || !active
      ? null
      : `${active.spot.vocab.emoji}  Press E to learn "${active.spot.vocab.en}"`,
  );

  input.endFrame();
});

engine.start();

// Handy while authoring content: inspect and teleport from the console.
(window as unknown as Record<string, unknown>).__world = {
  player,
  rig,
  progress,
  places: PLACES,
  goTo(placeId: string) {
    const place = PLACES.find((p) => p.id === placeId);
    if (!place) return `no such place: ${placeId}`;
    player.position.set(place.center[0], 0, place.center[1]);
    player.object.position.copy(player.position);
    return place.name;
  },
};

// The first frame is rendered by now, so the splash can go.
requestAnimationFrame(() => {
  document.querySelector("#loader")?.classList.add("is-hidden");
  window.setTimeout(() => document.querySelector("#loader")?.remove(), 700);
});
