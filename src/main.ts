import * as THREE from "three";
import "./styles.css";

import { Engine } from "./core/engine";
import { Input } from "./core/input";
import { BUILDING_BY_ID, type Building } from "./city/buildings";
import { City } from "./city/city";
import { DayNight } from "./city/daynight";
import { streetAt, visitsAt } from "./city/discovery";
import { KIT_REQUESTS } from "./city/kit";
import { loadKits } from "./city/kits";
import { Npcs } from "./city/npcs";
import { setNightGlow } from "./city/palette";
import { Traffic } from "./city/traffic";
import { MISSIONS } from "./game/missions";
import { refreshGrammarQuest, type Npc } from "./game/quests";
import {
  clearSave,
  createState,
  levelOf,
  loadState,
  saveState,
  statFor,
  XP_PER_CORRECT,
  XP_PRACTICE,
  XP_WITH_HINT,
} from "./game/state";
import { CameraRig } from "./game/cameraRig";
import { CharacterModel } from "./game/characterModel";
import { Player } from "./game/player";
import { CityHud } from "./ui/cityHud";
import { Dialog } from "./ui/dialog";
import { Speech } from "./learn/speech";
import { createEnvironment } from "./world/environment";

/**
 * Da World — a whole city, on foot, with somewhere to be.
 *
 * The city is City Explorer's: ninety-one named places on nine streets, built
 * from Kenney GLB kits, with traffic that stops at red lights and a sun that
 * goes down. What this engine adds is a third-person character you steer with
 * the mouse — and what this file wires up is the reason to steer it anywhere.
 *
 * That reason is the citizens. Thirty-two of them stand on the pavement with a
 * ❓ over their head, and each one asks a question generated from the city
 * itself: how do I get to the aquarium, where is the bakery, which word
 * finishes this sentence. Answering is XP, XP is levels, and the missions on
 * the HUD are the order to do it all in. Walking the route you were just given
 * is the game.
 *
 * Boot order matters: the models are several megabytes, so they are fetched
 * *before* the city is built, behind the splash screen, with the loading bar
 * following the real download.
 */

const container = document.querySelector<HTMLElement>("#app");
if (!container) throw new Error("#app container is missing from the document");

/** Where you wake up: the pavement on the north side of Main Street. */
const START = new THREE.Vector2(14, 7.5);
/**
 * Facing east, along the pavement.
 *
 * Not a detail: the default was to face the road, which put the camera behind
 * you inside the shop you had your back to and started the game on a shot of
 * the inside of a wall. Standing on a pavement, the interesting direction is
 * always down the street.
 */
const START_FACING = Math.PI / 2;

const loaderBar = document.querySelector<HTMLElement>("#loaderBar");
const setProgress = (fraction: number): void => {
  if (loaderBar) loaderBar.style.width = `${Math.round(fraction * 100)}%`;
};

async function boot(): Promise<void> {
  const engine = new Engine(container!);
  const environment = createEnvironment(engine.scene, engine.renderer);

  const state = createState();
  loadState(state);
  const dayNight = new DayNight(state.clock);

  await loadKits(KIT_REQUESTS, setProgress);

  const city = new City();
  engine.scene.add(city.group);

  const traffic = new Traffic();
  engine.scene.add(traffic.group);

  const npcs = new Npcs();
  npcs.applyProgress(state.helped);
  engine.scene.add(npcs.group);

  const player = new Player(START);
  player.body.facing = START_FACING;
  engine.scene.add(player.object);

  const rig = new CameraRig(engine.camera);
  rig.resetBehind(START_FACING);
  const input = new Input(engine.canvas);

  // --- UI -------------------------------------------------------------------
  const ui = document.createElement("div");
  ui.className = "ui-layer";
  container!.appendChild(ui);

  const speech = new Speech();
  const hud = new CityHud(ui, speech, state, {
    onReset: () => {
      clearSave();
      location.reload();
    },
    onPause: () => syncInput(),
  });

  /** The building a hint is pointing at, if any. */
  const hintTarget = (): Building | null =>
    state.hintTargetId ? BUILDING_BY_ID.get(state.hintTargetId) ?? null : null;

  function checkMissions(): void {
    for (const mission of MISSIONS) {
      if (!state.missionsDone.has(mission.id) && mission.get(state) >= mission.goal) {
        state.missionsDone.add(mission.id);
        hud.showToast(mission.icon, "Mission complete!", mission.label);
      }
    }
    if (!state.champion && state.missionsDone.size === MISSIONS.length) {
      state.champion = true;
      hud.showToast("👑", "City champion!", "Every mission in Da World is done.");
    }
    hud.refresh();
  }

  function addXp(amount: number): void {
    state.score += amount;
    const level = levelOf(state.score);
    if (level > state.level) {
      hud.showToast("🆙", `Level ${level}!`, "Keep helping the people of the city.");
    }
    state.level = level;
  }

  const dialog = new Dialog(ui, speech, {
    onCorrect(npc: Npc, firstTry: boolean) {
      // Answering a citizen a second time is *practice*: it still counts
      // towards the language-point missions, but it is worth less XP, so the
      // fastest way up is still to walk the city and meet somebody new.
      const repeat = npc.done;
      npc.done = true;
      state.helped.add(npc.id);
      state.correct++;
      state.attempts += npc.quest.attempts ?? 1;

      const stat = statFor(state, npc.quest.tag);
      stat.asked++;
      stat.correct++;
      if (firstTry) stat.firstTry++;
      if (npc.quest.hintUsed) stat.hints++;

      const xp = repeat ? XP_PRACTICE : npc.quest.hintUsed ? XP_WITH_HINT : XP_PER_CORRECT;
      addXp(xp);
      if (state.hintTargetId && npc.quest.target?.id === state.hintTargetId) {
        state.hintTargetId = null;
      }
      npcs.refreshMarker(npc.id);
      hud.showToast(
        "✅",
        `+${xp} XP`,
        repeat ? "Practice round — nicely done." : `${npc.name} knows the way now.`,
      );
      // Grammar citizens immediately draw the next item from the bank, so a
      // language point can be drilled without hunting for a new face.
      refreshGrammarQuest(npc);
      checkMissions();
      saveState(state);
    },
    onWrong() {
      /* The card says what went wrong; nothing else has to happen. */
    },
    onHint(npc: Npc) {
      if (npc.quest.target) state.hintTargetId = npc.quest.target.id;
    },
    onMinimize: () => syncInput(),
    onClose: () => syncInput(),
  });

  /** The world only listens while nothing is covering it. */
  const busy = (): boolean => dialog.open || hud.isBlocking;
  function syncInput(): void {
    const paused = busy();
    input.enabled = !paused;
    if (paused) {
      input.move.set(0, 0);
      input.releasePointerLock();
    }
  }

  /** The citizen close enough to talk to, refreshed every frame. */
  let near: Npc | null = null;

  /** Open a conversation, clearing anything that would sit on top of the card. */
  function talk(npc: Npc): void {
    hud.clearToast();
    dialog.show(npc);
    syncInput();
  }

  input.onInteract(() => {
    if (busy()) return;
    if (dialog.minimized && dialog.current) talk(dialog.current);
    else if (near) talk(near);
  });

  input.onCancel(() => {
    if (dialog.open) dialog.close();
    else if (hud.closeTop()) return;
    else input.releasePointerLock();
  });

  // Clicking the world hands the mouse to the camera, which is what a
  // third-person game does and what makes the aiming feel direct. Escape (or a
  // card opening) gives it back — the browser insists on that, and so should we.
  engine.canvas.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "touch" || busy()) return;
    input.requestPointerLock();
  });

  addEventListener("keydown", (event) => {
    if (event.key.toLowerCase() === "r" && !busy()) rig.resetBehind(player.body.facing);
    if (event.key.toLowerCase() === "m" && !dialog.open) hud.toggleMissions(!hud.isMissionsOpen);
  });

  addEventListener("beforeunload", () => {
    state.clock = dayNight.hours;
    saveState(state);
  });

  // --- loop -----------------------------------------------------------------
  let saveTimer = 0;

  engine.onUpdate((dt, elapsed) => {
    input.update();
    const paused = busy();

    if (!paused) dayNight.advance(dt);
    const sky = dayNight.current();
    environment.apply(sky);
    engine.post.setMood(sky.night);
    setNightGlow(sky.night);
    city.setNight(sky.night);

    rig.update(dt, input, player.position, player.body.facing, input.isMoving, input.sprint);
    if (!paused) player.update(dt, input, rig.yaw, rig.isManual);

    environment.follow(elapsed, player.position);
    traffic.update(dt, elapsed, player.position.x, player.position.z);
    npcs.update(dt, elapsed, player.position.x, player.position.z);
    city.update(elapsed, hintTarget());

    if (!paused) {
      state.playtime += dt;

      // Walking past a door quietly ticks the place off. No card, no name in
      // your face: the missions count it and the HUD tally goes up by one.
      const visits = visitsAt(player.position.x, player.position.z, state.found);
      if (visits.length) {
        for (const visit of visits) state.found.add(visit.id);
        checkMissions();
        saveState(state);
      }

      near = npcs.nearest(player.position.x, player.position.z);
      hud.setTalkHint(dialog.minimized ? null : near);

      saveTimer += dt;
      if (saveTimer > 20) {
        saveTimer = 0;
        state.clock = dayNight.hours;
        saveState(state);
      }
    } else {
      hud.setTalkHint(null);
    }

    hud.setStreet(streetAt(player.position.x, player.position.z));
    hud.setClock(`${dayNight.clockText()}  ·  ${dayNight.phase().name}`);
    hud.update(dt);

    input.endFrame();
  });

  engine.start();
  checkMissions();

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
    npcs,
    state,
    engine,
    goTo: (x: number, z: number, facing = player.body.facing) => {
      player.teleport(x, z);
      player.body.facing = facing;
      rig.resetBehind(facing);
      rig.snapTo(player.position);
    },
    /** Walk up to the nearest citizen and open their card — used by the smoke test. */
    talkTo: (name: string) => {
      const npc = npcs.npcs.find((n) => n.name === name) ?? npcs.npcs[0];
      player.teleport(npc.x + 1, npc.y);
      player.body.facing = -Math.PI / 2;
      rig.resetBehind(-Math.PI / 2);
      rig.snapTo(player.position);
      talk(npc);
      return npc.name;
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

    window.setTimeout(
      () =>
        hud.showToast(
          "🚸",
          "Welcome to Da World",
          "Stay on the pavement, cross at the crossings, and press E to talk to anybody with a ❓.",
        ),
      900,
    );
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
