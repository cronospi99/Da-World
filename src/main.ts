import * as THREE from "three";
import "./styles.css";

import { Engine } from "./core/engine";
import { Input } from "./core/input";
import { City } from "./city/city";
import { DayNight } from "./city/daynight";
import { Explorer, streetAt, type Discovery } from "./city/discovery";
import { KIT_REQUESTS } from "./city/kit";
import { loadKits } from "./city/kits";
import { setNightGlow } from "./city/palette";
import { Pedestrians } from "./city/pedestrians";
import { Traffic } from "./city/traffic";
import { CameraRig } from "./game/cameraRig";
import { CharacterModel } from "./game/characterModel";
import { Player } from "./game/player";
import { CityHud } from "./ui/cityHud";
import { Speech } from "./learn/speech";
import { createEnvironment } from "./world/environment";

/**
 * Da World — a whole city, on foot.
 *
 * The island this game started on has been replaced by the City Explorer
 * world: ninety-one named places on nine streets, built from Kenney GLB kits,
 * with traffic that stops at red lights and a sun that goes down. What is left
 * of the original is the part worth keeping — the engine, the graded look, the
 * rigged character and the feel of its movement — now pointed at a street
 * instead of a meadow.
 *
 * Boot order matters and is the one thing that changed structurally: the models
 * are several megabytes, so they are fetched *before* the city is built, behind
 * the splash screen, with the loading bar following the real download.
 */

const container = document.querySelector<HTMLElement>("#app");
if (!container) throw new Error("#app container is missing from the document");

/** Where you wake up: the pavement on the north side of Main Street. */
const START = new THREE.Vector2(24, 6.4);

const loaderBar = document.querySelector<HTMLElement>("#loaderBar");
const setProgress = (fraction: number): void => {
  if (loaderBar) loaderBar.style.width = `${Math.round(fraction * 100)}%`;
};

async function boot(): Promise<void> {
  const engine = new Engine(container!);
  const environment = createEnvironment(engine.scene, engine.renderer);
  const dayNight = new DayNight(9);

  await loadKits(KIT_REQUESTS, setProgress);

  const city = new City();
  engine.scene.add(city.group);
  // The city can float a name plate over the two nearest places. That was
  // written for a camera looking down at the rooftops; from the pavement the
  // plates are the size of a bus and cover the street you are trying to read.
  // The painted fascias say the same thing, in the place a sign belongs.
  city.hintMarker.visible = false;

  const traffic = new Traffic();
  engine.scene.add(traffic.group);

  const pedestrians = new Pedestrians();
  engine.scene.add(pedestrians.group);

  const player = new Player(START);
  engine.scene.add(player.object);

  const rig = new CameraRig(engine.camera);
  const input = new Input(engine.canvas);

  // --- UI -------------------------------------------------------------------
  const ui = document.createElement("div");
  ui.className = "ui-layer";
  container!.appendChild(ui);

  const speech = new Speech();
  const explorer = new Explorer();
  const hud = new CityHud(ui, speech, explorer, {
    onReset: () => explorer.reset(),
    onPause: (paused) => {
      input.enabled = !paused;
      if (paused) {
        input.move.set(0, 0);
        input.releasePointerLock();
      }
    },
  });

  /** The place whose door we are standing at, refreshed every frame. */
  let nearby: Discovery | null = null;

  function open(place: Discovery): void {
    const isNew = explorer.discover(place);
    hud.showPlace(place, isNew);
    if (isNew && explorer.found.size === explorer.total) {
      hud.showToast("Every place found!", "You have walked the whole city.");
    }
  }

  input.onInteract(() => {
    if (hud.isBlocking) return;
    if (nearby) open(nearby);
  });

  input.onCancel(() => {
    if (hud.isCardOpen) hud.closeCard();
    else if (hud.isInfoOpen) hud.toggleInfo(false);
    else input.releasePointerLock();
  });

  // Clicking the world hands the mouse to the camera, which is what a
  // third-person game does and what makes the aiming feel direct. Escape (or a
  // card opening) gives it back — the browser insists on that, and so should we.
  engine.canvas.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "touch" || hud.isBlocking) return;
    input.requestPointerLock();
  });

  addEventListener("keydown", (event) => {
    if (event.key.toLowerCase() === "r" && !hud.isBlocking) rig.resetBehind(player.body.facing);
  });

  // --- loop -----------------------------------------------------------------
  engine.onUpdate((dt, elapsed) => {
    input.update();

    if (!hud.isBlocking) dayNight.advance(dt);
    const sky = dayNight.current();
    environment.apply(sky);
    engine.post.setMood(sky.night);
    setNightGlow(sky.night);
    city.setNight(sky.night);

    rig.update(dt, input, player.position, player.body.facing, input.isMoving, input.sprint);
    if (!hud.isBlocking) player.update(dt, input, rig.yaw, rig.isManual);

    environment.follow(elapsed, player.position);
    traffic.update(dt, elapsed, player.position.x, player.position.z);
    pedestrians.update(dt, player.position.x, player.position.z);

    nearby = explorer.nearest(player.position.x, player.position.z);
    hud.setStreet(streetAt(player.position.x, player.position.z));
    hud.setClock(`${dayNight.clockText()}  ·  ${dayNight.phase().name}`);
    hud.setHint(hud.isBlocking || !nearby ? null : `${nearby.emoji}  Press E — ${nearby.name}`);
    hud.update(dt);

    input.endFrame();
  });

  engine.start();

  // The rigged model arrives after the first frame; until then the primitive
  // stand-in is on screen, so a slow or missing GLB never blocks play.
  CharacterModel.load()
    .then((model) => player.attachModel(model))
    .catch((error) => {
      console.warn("Character model failed to load, keeping the stand-in.", error);
    });

  // Handy while working on the city: inspect and teleport from the console.
  (window as unknown as Record<string, unknown>).__world = {
    player,
    rig,
    city,
    dayNight,
    explorer,
    engine,
    goTo: (x: number, z: number, facing = player.body.facing) => {
      player.teleport(x, z);
      rig.resetBehind(facing);
    },
    setHour: (hour: number) => dayNight.setHours(hour),
    stats: () => ({ ...engine.renderer.info.render }),
  };

  // The first frame is rendered by now, so the splash can go. The world then
  // fades up out of paper white, matching the original intro transition.
  requestAnimationFrame(() => {
    document.querySelector("#loader")?.classList.add("is-hidden");
    window.setTimeout(() => document.querySelector("#loader")?.remove(), 700);

    const start = performance.now();
    const FADE_MS = 1400;
    const fade = (): void => {
      const t = Math.min((performance.now() - start) / FADE_MS, 1);
      engine.post.setTransition(t * t * (3 - 2 * t));
      if (t < 1) requestAnimationFrame(fade);
    };
    engine.post.setTransition(0);
    fade();
  });
}

boot().catch((error) => {
  console.error(error);
  const loader = document.querySelector("#loader");
  if (loader) {
    loader.innerHTML = `<h1>Oh no</h1><p class="loader-error">The city could not start.<br>${String(
      error,
    )}</p>`;
  }
});
