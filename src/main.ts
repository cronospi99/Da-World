import * as THREE from "three";
import "./styles.css";

import { Engine } from "./core/engine";
import { Input } from "./core/input";
import { detectQuality, rememberQuality, QUALITY } from "./core/quality";
import { BUILDING_BY_ID, type Building } from "./city/buildings";
import { City } from "./city/city";
import { BODY_RADIUS } from "./city/ground";
import { DayNight } from "./city/daynight";
import { streetAt, visitsAt } from "./city/discovery";
import { KIT_REQUESTS } from "./city/kit";
import { loadKits } from "./city/kits";
import { Npcs } from "./city/npcs";
import { setNightGlow } from "./city/palette";
import { setTextureAnisotropy } from "./city/textures";
import { Traffic } from "./city/traffic";
import { missionsFor, type Mission } from "./game/missions";
import { MODES, rememberMode, type GameMode } from "./game/modes";
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
import { Player } from "./game/player";
import { CityHud } from "./ui/cityHud";
import { Menu } from "./ui/menu";
import { TeacherPanel } from "./ui/teacher";
import { TouchControls, isTouchDevice } from "./ui/touch";
import { Lobby } from "./ui/lobby";
import { Classmates } from "./city/classmates";
import { NetClient } from "./net/client";
import { PeerGuest, PeerHost, clearCodeInUrl, codeInUrl, joinUrl } from "./net/peer";
import { MAX_PLAYERS } from "./net/protocol";
import { NO_SESSION, type NetHandlers, type Session } from "./net/session";
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
const START = new THREE.Vector2(24, 11.5);
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
  // The graphics settings are chosen before anything is built, because two of
  // them — the anisotropy on the ground textures and the size of the sun's
  // shadow map — are baked into things the city makes at construction time.
  const quality = detectQuality();
  setTextureAnisotropy(QUALITY[quality].anisotropy);

  const engine = new Engine(container!, quality);
  const environment = createEnvironment(engine.scene, engine.renderer);
  environment.setShadowQuality(QUALITY[quality].shadowMap, QUALITY[quality].shadowRadius);

  const state = createState();
  loadState(state);
  const dayNight = new DayNight(state.clock);

  await loadKits(KIT_REQUESTS, setProgress);

  const city = new City();
  engine.scene.add(city.group);

  const traffic = new Traffic();
  engine.scene.add(traffic.group);

  // The mode decides what the citizens ask, so the crowd cannot be built until
  // it is chosen. Everything else — the city, the traffic, the sun — is the
  // same city whichever mode is played, and is built once behind the splash.
  let mode: GameMode = MODES.vocabulary;
  /** True once a mode has been started, so the HUD and controls are live. */
  let playing = false;
  let missions: Mission[] = missionsFor(mode);
  let npcs = new Npcs(mode);
  engine.scene.add(npcs.group);

  // Everybody else in the room, when there is a room. Empty and free the rest
  // of the time — Class mode is the only mode with anybody else in it.
  const classmates = new Classmates();
  engine.scene.add(classmates.group);

  const player = new Player(START);
  player.body.facing = START_FACING;
  // The crowd is solid: you stop against the person you are walking up to
  // rather than standing inside them while they talk to you.
  player.body.crowd = (x, z) => npcs.blocks(x, z, BODY_RADIUS);
  engine.scene.add(player.object);

  const rig = new CameraRig(engine.camera);
  rig.resetBehind(START_FACING);
  const input = new Input(engine.canvas);

  // --- UI -------------------------------------------------------------------
  const ui = document.createElement("div");
  ui.className = "ui-layer";
  container!.appendChild(ui);

  const speech = new Speech();
  const hud = new CityHud(ui, speech, state, () => missions, {
    onReset: () => {
      clearSave();
      location.reload();
    },
    onPause: () => syncInput(),
    // Shown only while there is a room: it is how a host puts the QR code back
    // on the board for the student who arrived late.
    onRoom: () => {
      lobby.open();
      syncInput();
    },
  });

  /** The building a hint is pointing at, if any. */
  const hintTarget = (): Building | null =>
    state.hintTargetId ? BUILDING_BY_ID.get(state.hintTargetId) ?? null : null;

  function checkMissions(): void {
    for (const mission of missions) {
      if (!state.missionsDone.has(mission.id) && mission.get(state) >= mission.goal) {
        state.missionsDone.add(mission.id);
        hud.showToast(mission.icon, "Mission complete!", mission.label);
      }
    }
    if (!state.champion && missions.every((m) => state.missionsDone.has(m.id))) {
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
      net.progress(state.score, state.helped.size);
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
  const busy = (): boolean =>
    dialog.open || hud.isBlocking || menu.isOpen || teacher.isOpen || lobby.isOpen;
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

  /** The one verb: talk to whoever is in front of you, or resume a card. */
  function tryTalk(): void {
    if (busy()) return;
    if (dialog.minimized && dialog.current) talk(dialog.current);
    else if (near) talk(near);
  }

  input.onInteract(() => tryTalk());

  input.onCancel(() => {
    if (dialog.open) dialog.close();
    else if (teacher.isOpen) teacher.toggle(false);
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
    // The thumb controls come off the screen whenever a card is over it: they
    // are drawn above the world, and a stick sitting on top of an answer is
    // both ugly and, since it still takes the touch, wrong.
    touch?.setVisible(playing && !paused);

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
    classmates.update(dt, player.position.x, player.position.z);
    if (!paused) net.move(player.position.x, player.position.z, player.body.facing);
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
      touch?.setTalkReady(!!near || dialog.minimized);

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

  /**
   * Start a mode.
   *
   * The city stays; the crowd is rebuilt, because who is standing where is the
   * same but what they ask is not. Progress is deliberately *not* reset — a
   * class that switches from Vocabulary to Directions keeps the places it has
   * walked past and the citizens it has already helped.
   */
  function startMode(next: GameMode): void {
    mode = next;
    missions = missionsFor(mode);
    rememberMode(mode.id);

    engine.scene.remove(npcs.group);
    npcs = new Npcs(mode);
    npcs.applyProgress(state.helped);
    engine.scene.add(npcs.group);
    player.body.crowd = (x, z) => npcs.blocks(x, z, BODY_RADIUS);
    near = null;

    playing = true;
    menu.hide();
    hud.setMode(mode);
    checkMissions();
    syncInput();

  }

  /* --------------------------- the class -------------------------------- */

  /**
   * The room, whoever is holding it.
   *
   * Three things can be behind this: nothing at all, which is how the game
   * spends most of its life; a `PeerHost`, when this browser *is* the server
   * and the class scanned its code; or a guest session talking to somebody
   * else's browser or to the node relay. The city below does not know which,
   * and asks all three the same four things.
   */
  let net: Session = NO_SESSION;
  let host: PeerHost | null = null;

  /** The chip in the corner: which room this is, and how full. */
  function refreshRoom(): void {
    if (!net.connected) {
      hud.setRoom(null);
      return;
    }
    const people = classmates.peers().length + 1;
    const fullness = `${people}/${MAX_PLAYERS}`;
    hud.setRoom(host?.code ? `${host.code}  ·  ${fullness}` : fullness);
  }

  const netHandlers: NetHandlers = {
    onReady: (_you, peers, goal, netMode) => {
      lobby.toggle(false);
      classmates.clear();
      for (const peer of peers) classmates.add(peer);
      state.focusMissionId = goal;
      const chosen = netMode ? MODES[netMode as keyof typeof MODES] : null;
      startMode(chosen ?? MODES.vocabulary);
      refreshRoom();
      hud.showToast("👥", "You are in the class", `${peers.length + 1} in the city.`);
    },
    onDenied: (reason) => lobby.fail(reason),
    onJoined: (peer) => {
      classmates.add(peer);
      refreshRoom();
      hud.showToast("👋", `${peer.name} joined`, `${classmates.peers().length + 1} in the city.`);
    },
    onLeft: (id) => {
      classmates.remove(id);
      refreshRoom();
    },
    onPositions: (peers) => classmates.setPositions(peers),
    onProgress: (id, score, helped) => classmates.setProgress(id, score, helped),
    onGoal: (missionId) => {
      state.focusMissionId = missionId;
      hud.refresh();
      if (missionId) {
        const mission = missions.find((m) => m.id === missionId);
        if (mission) hud.showToast("🎯", "New mission from your teacher", mission.label);
      }
    },
    onMode: (modeId) => {
      const chosen = MODES[modeId as keyof typeof MODES];
      if (chosen && chosen.id !== mode.id) startMode(chosen);
    },
    onClosed: () => {
      classmates.clear();
      refreshRoom();
      if (playing) {
        hud.showToast("🔌", "Disconnected from the class", "The city carries on without them.");
      }
    },
  };

  /** Leave whatever room we are in, quietly. */
  function leaveRoom(): void {
    net.close();
    net = NO_SESSION;
    host = null;
    classmates.clear();
    refreshRoom();
  }

  /**
   * Open a room in this browser.
   *
   * The host is a player like everybody else and their city starts the moment
   * the code exists, so they can be walking around it while the class is still
   * getting their phones out. The mode is set here rather than left to drift:
   * whoever hosts decides what the room is playing, and everybody who scans in
   * afterwards is told on arrival.
   */
  function openRoom(name: string): Promise<void> {
    leaveRoom();
    return new Promise<void>((resolve, reject) => {
      let opened = false;
      const created = new PeerHost(name, {
        onOpen: (code) => {
          opened = true;
          lobby.showRoom(code, joinUrl(code));
          refreshRoom();
          resolve();
        },
        onRoster: (peers) => {
          lobby.setRoster(peers);
          refreshRoom();
        },
        onError: (reason) => {
          if (opened) lobby.fail(reason);
          else reject(new Error(reason));
        },
        onJoined: netHandlers.onJoined,
        onLeft: netHandlers.onLeft,
        onPositions: netHandlers.onPositions,
        onProgress: netHandlers.onProgress,
      });
      host = created;
      net = created;
      // Hosting is the one claim to the teacher's panel that cannot be
      // borrowed: the room only exists while this tab does.
      teacher.unlock();
      startMode(MODES.multiplayer);
      created.setMode(MODES.multiplayer.id);
    });
  }

  const lobby = new Lobby(ui, {
    onHost: (name) => openRoom(name),
    onJoin: (code, name) => {
      leaveRoom();
      const guest = new PeerGuest(netHandlers, {
        code,
        name,
        onStatus: (text) => lobby.setStatus(text),
      });
      net = guest;
      return guest.join();
    },
    onServerJoin: (details) => {
      leaveRoom();
      const client = new NetClient(netHandlers);
      net = client;
      return client.join({
        url: details.url,
        room: details.room,
        name: details.name,
        role: details.asTeacher ? "teacher" : "student",
        passphrase: details.passphrase,
      });
    },
    onEnter: () => syncInput(),
    onCloseRoom: () => leaveRoom(),
    onCancel: () => menu.show(),
  });

  // Drawn only where there are thumbs. On a phone held upright the desktop
  // scheme — invisible stick, tap to jump — is undiscoverable, so the controls
  // are on the screen where you can see them.
  const touch = isTouchDevice()
    ? new TouchControls(ui, input, { onTalk: () => tryTalk() })
    : null;

  const menu = new Menu(ui, state, quality, {
    onStart: (chosen) => {
      // Class mode is the one that needs somewhere to connect to, so it asks
      // before it starts; everything else walks straight into the city.
      if (chosen.networked) {
        menu.hide();
        lobby.open();
        return;
      }
      startMode(chosen);
    },
    onQuality: (name) => {
      engine.setQuality(name);
      environment.setShadowQuality(QUALITY[name].shadowMap, QUALITY[name].shadowRadius);
      setTextureAnisotropy(QUALITY[name].anisotropy);
      rememberQuality(name);
    },
    onTeacher: () => teacher.toggle(true),
  });

  const teacher = new TeacherPanel(ui, state, {
    onSetGoal: (mission) => {
      state.focusMissionId = mission?.id ?? null;
      hud.refresh();
      saveState(state);
      // In a class the goal is the room's, not this browser's: the server
      // fans it out and every screen shows the same line.
      net.setGoal(state.focusMissionId);
    },
    onSwitchMode: (chosen) => {
      teacher.toggle(false);
      net.setMode(chosen.id);
      startMode(chosen);
    },
    onPause: () => syncInput(),
  });

  engine.start();
  checkMissions();

  // Arrived by scanning somebody's QR code: skip the menu entirely and ask for
  // the one thing the code cannot carry, which is who this is. The code is
  // then wiped from the address bar, so a reload does not silently rejoin a
  // lesson that finished an hour ago.
  const scanned = codeInUrl();
  if (scanned) {
    menu.hide();
    lobby.openWithCode(scanned);
    clearCodeInUrl();
    syncInput();
  }

  // Handy while working on the city: inspect and teleport from the console.
  (window as unknown as Record<string, unknown>).__world = {
    player,
    rig,
    city,
    dayNight,
    state,
    engine,
    // A getter, not a value: switching mode rebuilds the crowd, and a captured
    // reference would quietly hand out the citizens of the previous lesson.
    get npcs() {
      return npcs;
    },
    get mode() {
      return mode;
    },
    classmates,
    classmatesGroup: classmates.group,
    // The room, for the QR smoke test and for poking at a lesson that is
    // misbehaving. Getters, because both are replaced when a room changes.
    get host() {
      return host;
    },
    get net() {
      return net;
    },
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
          touch
            ? "Stay on the pavement, cross at the crossings, and tap 💬 to talk to anybody with a ❓."
            : "Stay on the pavement, cross at the crossings, and press E to talk to anybody with a ❓.",
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
