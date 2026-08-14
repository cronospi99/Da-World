import * as THREE from "three";
import "./styles.css";

import { Engine } from "./core/engine";
import { Input, isTyping } from "./core/input";
import { detectQuality, rememberQuality, QUALITY } from "./core/quality";
import { BUILDING_BY_ID, type Building } from "./city/buildings";
import { City, TREE_SPOTS } from "./city/city";
import { BODY_RADIUS } from "./city/ground";
import { DayNight } from "./city/daynight";
import { streetAt, visitsAt } from "./city/discovery";
import { isSidewalk } from "./city/layout";
import { KIT_REQUESTS } from "./city/kit";
import { loadKits } from "./city/kits";
import { Npcs } from "./city/npcs";
import { setNightGlow } from "./city/palette";
import { setTextureAnisotropy } from "./city/textures";
import { Traffic } from "./city/traffic";
import { missionsFor, type Mission } from "./game/missions";
import { MODES, rememberMode, type GameMode } from "./game/modes";
import { advanceQuest, type Npc } from "./game/quests";
import { Detective, type Suspect } from "./game/detective";
import {
  clearSave,
  createState,
  levelOf,
  loadState,
  saveState,
  statFor,
  XP_CASE_CLOSED,
  XP_PER_CORRECT,
  XP_PRACTICE,
  XP_WITH_HINT,
} from "./game/state";
import { CameraRig } from "./game/cameraRig";
import { Player } from "./game/player";
import {
  loadAppearance,
  saveAppearance,
  type Appearance,
  type BodyKind,
} from "./game/appearance";
import { drawnBounds } from "./game/characterModel";
import { CharacterPanel } from "./ui/character";
import { CaseFile } from "./ui/casefile";
import { VocabCheck } from "./ui/vocabCheck";
import { Leaderboard, type LeaderRow } from "./ui/leaderboard";
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

  /**
   * The open case, in Family Detective, and null in every other mode.
   *
   * It is built before the crowd because the crowd is built *out of* it —
   * every citizen is handed one of the case's clues — and it outlives a
   * reload, restored from the seed and the fact ids in the save file.
   */
  let detective: Detective | null = null;
  let npcs = new Npcs(mode);
  engine.scene.add(npcs.group);

  // Everybody else in the room, when there is a room. Empty and free the rest
  // of the time — Class mode is the only mode with anybody else in it.
  const classmates = new Classmates();
  engine.scene.add(classmates.group);

  // Who you are, from the last time you chose. The customiser can change it
  // while the game is running, and whoever else is in the room is told, so it
  // is a variable rather than a constant.
  let appearance: Appearance = loadAppearance();

  const player = new Player(START, appearance);
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
    onCharacter: () => {
      character.toggle(true);
      syncInput();
    },
    onLeaderboard: () => {
      refreshBoard();
      leaderboard.toggle(true);
      syncInput();
    },
    onCaseFile: () => {
      caseFile.setCase(detective);
      caseFile.toggle(true);
      syncInput();
    },
    onVocab: () => {
      vocab.toggle(true);
      syncInput();
    },
    // Back to the front door. Nothing is thrown away — the save has already
    // been written on every answer, and the city itself is still standing
    // behind the panel.
    onMenu: () => {
      saveState(state);
      menu.show();
      syncInput();
    },
  });

  const leaderboard = new Leaderboard(ui, () => syncInput());

  const vocab = new VocabCheck(ui, speech, () => syncInput());

  const caseFile = new CaseFile(ui, {
    onAccuse: (suspect: Suspect) => accuse(suspect),
    onNewCase: () => {
      openCase(null);
      hud.showToast("🔎", "A new case", "Eighteen suspects again. Go and ask somebody.");
    },
    onClose: () => syncInput(),
  });

  /** The building a hint is pointing at, if any. */
  const hintTarget = (): Building | null =>
    state.hintTargetId ? BUILDING_BY_ID.get(state.hintTargetId) ?? null : null;

  function checkMissions(): void {
    let finished = false;
    for (const mission of missions) {
      if (!state.missionsDone.has(mission.id) && mission.get(state) >= mission.goal) {
        state.missionsDone.add(mission.id);
        finished = true;
        hud.showToast(mission.icon, "Mission complete!", mission.label);
      }
    }
    if (!state.champion && missions.every((m) => state.missionsDone.has(m.id))) {
      state.champion = true;
      hud.showToast("👑", "City champion!", "Every mission in Da World is done.");
    }
    // A mission can finish by walking past a door as well as by answering
    // somebody, so the room hears about it from here rather than from the
    // answer — otherwise the leaderboard lags a lap behind the race.
    if (finished) reportProgress();

    // Off the network the race still counts, and there is nobody to referee
    // it: one player, one target, and the moment they reach it they have won.
    if (!net.connected && winTarget > 0 && !winner && state.missionsDone.size >= winTarget) {
      winner = { id: myId, name: myName };
      hud.showToast("🏆", "You won!", `${winTarget} missions finished.`);
      refreshBoard();
    }
    hud.refresh();
  }

  /* --------------------------- the case ---------------------------------- */

  /**
   * Open a case: the saved one if there is one, otherwise a fresh culprit.
   *
   * Rebuilding the crowd is not optional here — the citizens hold the clues,
   * so a new case with the old crowd would be thirty-two people telling you
   * about the wrong person. `startMode` does the rebuild for the first case;
   * "New case" from the file has to ask for it.
   */
  function openCase(seed: number | null): void {
    const actual = seed ?? (Date.now() & 0x7fffffff);
    detective = new Detective(actual);
    if (seed === null) state.caseFacts = [];
    else detective.restore(state.caseFacts);
    state.caseSeed = actual;
    rememberCase();
    rebuildCrowd();
    refreshCaseUi();
  }

  /** Write the case down, so a locked phone does not cost an hour's work. */
  function rememberCase(): void {
    state.caseFacts = detective ? detective.factIds() : [];
    saveState(state);
  }

  function refreshCaseUi(): void {
    hud.setCaseCount(detective && !detective.solved ? detective.remaining.length : null);
    caseFile.setCase(detective);
  }

  /** Rebuild the citizens for the current mode and case, keeping progress. */
  function rebuildCrowd(): void {
    engine.scene.remove(npcs.group);
    npcs = new Npcs(mode, detective);
    npcs.applyProgress(state.helped);
    engine.scene.add(npcs.group);
    player.body.crowd = (x, z) => npcs.blocks(x, z, BODY_RADIUS);
    near = null;
    if (dialog.open || dialog.minimized) dialog.close();
  }

  function accuse(suspect: Suspect) {
    const result = detective!.accuse(suspect);
    if (result.right) {
      state.casesSolved++;
      addXp(XP_CASE_CLOSED);
      // The case is over, so there is nothing left to restore: a reload now
      // should deal a new culprit rather than reopen a solved file.
      state.caseSeed = null;
      state.caseFacts = [];
      hud.showToast(
        "🕵️",
        `+${XP_CASE_CLOSED} XP — case closed!`,
        `It was ${suspect.name}, your ${suspect.relation.toLowerCase()}.`,
      );
      checkMissions();
      saveState(state);
      reportProgress();
    }
    refreshCaseUi();
    return result;
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

      // A clue is the point of the answer, not a reward for it: getting the
      // adverb right is *how* you learn something about the person you are
      // hunting. Somebody else may have already told you the same thing, in
      // which case the English still counted and the file simply does not
      // grow — and saying so is kinder than a silent nothing.
      const clue = npc.quest.clue;
      let learned = false;
      if (clue && detective) {
        learned = detective.collect(clue);
        if (learned) {
          state.cluesFound++;
          rememberCase();
        }
        refreshCaseUi();
      }

      hud.showToast(
        learned ? "🔍" : "✅",
        `+${xp} XP`,
        learned
          ? `New clue — ${detective!.remaining.length} suspects left.`
          : clue
            ? "You already knew that one, but the English still counts."
            : repeat
              ? "Practice round — nicely done."
              : `${npc.name} knows the way now.`,
      );
      // Grammar citizens draw the next item from the bank and clue citizens
      // fall back to frequency practice, so a language point can be drilled
      // without hunting for a new face.
      advanceQuest(npc);
      checkMissions();
      saveState(state);
      reportProgress();
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
    dialog.open ||
    hud.isBlocking ||
    menu.isOpen ||
    teacher.isOpen ||
    lobby.isOpen ||
    character.isOpen ||
    leaderboard.isOpen ||
    caseFile.isOpen ||
    vocab.isOpen;
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
    else if (caseFile.isOpen) caseFile.toggle(false);
    else if (vocab.isOpen) vocab.toggle(false);
    else if (leaderboard.isOpen) leaderboard.toggle(false);
    else if (character.isOpen) character.toggle(false);
    else if (lobby.isOpen) lobby.dismiss();
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
    // The same rule as the controller's: a shortcut must never fire while
    // somebody is typing their name. "m" used to open the mission list from
    // inside the name box.
    if (isTyping(event.target)) return;
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
    hud.setMode(mode);

    // Family Detective needs a culprit before it has a crowd, because the
    // crowd is what carries the clues. An unfinished case is picked up where
    // it was left — including across a reload, which is the whole reason the
    // seed is in the save file — and anything else starts a fresh one.
    if (mode.id === "detective" && (!detective || detective.solved)) {
      // Opens the case *and* rebuilds the crowd around it — the citizens are
      // dealt their clues at the moment the culprit is chosen.
      openCase(state.caseSeed);
    } else {
      if (mode.id !== "detective") detective = null;
      rebuildCrowd();
      refreshCaseUi();
    }

    playing = true;
    menu.hide();
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
  /**
   * How many missions win the match, and who got there first.
   *
   * The teacher sets it; in a room the host or the server decides who wins,
   * because twelve browsers each deciding they were first is twelve winners.
   * Off (zero) unless somebody sets it, which is most lessons.
   */
  let winTarget = 0;
  let winner: { id: string; name: string } | null = null;
  /** What the room calls us, once we have joined one. */
  let myName = "You";
  /**
   * The id the room gave us.
   *
   * Needed because "did *I* win?" is answered by comparing ids, and our own
   * row on the leaderboard is built from local state rather than from a peer
   * record — so without this it would be the one row that never matches the
   * winner the host announced.
   */
  let myId = "me";

  /** Everything the room ranks on, sent whenever one of them changes. */
  function reportProgress(): void {
    net.progress(state.score, state.helped.size, state.missionsDone.size);
    refreshBoard();
  }

  /** The rows of the leaderboard: everybody in the room, me included. */
  function boardRows(): LeaderRow[] {
    const mine: LeaderRow = {
      id: myId,
      name: myName,
      teacher: host !== null,
      missions: state.missionsDone.size,
      score: state.score,
      helped: state.helped.size,
      you: true,
    };
    const others = classmates.peers().map((peer) => ({
      id: peer.id,
      name: peer.name,
      teacher: peer.role === "teacher",
      missions: peer.missions,
      score: peer.score,
      helped: peer.helped,
      you: false,
    }));
    return [mine, ...others];
  }

  function refreshBoard(): void {
    leaderboard.update(boardRows(), winTarget, winner);
  }

  /** The chip in the corner: which room this is, and how full. */
  function refreshRoom(): void {
    if (!net.connected) {
      hud.setRoom(null);
      return;
    }
    const people = classmates.peers().length + 1;
    // The code button belongs to whoever is holding the room open. A student
    // has nothing to do with it and gets the leaderboard instead.
    hud.setRoom(host?.code ? `${host.code}  ·  ${people}/${MAX_PLAYERS}` : null);
  }

  const netHandlers: NetHandlers = {
    onReady: (you, peers, goal, netMode, target, roomWinner) => {
      myId = you;
      lobby.toggle(false);
      classmates.clear();
      for (const peer of peers) classmates.add(peer);
      state.focusMissionId = goal;
      winTarget = target;
      winner = roomWinner;
      teacher.setTarget(target);
      const chosen = netMode ? MODES[netMode as keyof typeof MODES] : null;
      startMode(chosen ?? MODES.vocabulary);
      refreshRoom();
      hud.setLeaderboard(true);
      reportProgress();
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
    onProgress: (id, score, helped, missions) => {
      classmates.setProgress(id, score, helped, missions);
      refreshBoard();
    },
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
    onTarget: (missions) => {
      winTarget = missions;
      winner = null;
      teacher.setTarget(missions);
      refreshBoard();
      hud.showToast(
        "🏁",
        missions > 0 ? "The race is on" : "No race",
        missions > 0
          ? `First to ${missions} mission${missions === 1 ? "" : "s"} wins.`
          : "Your teacher has called the race off.",
      );
    },
    onWon: (id, name, missions) => {
      winner = { id, name };
      refreshBoard();
      // Everybody is told, winner included, and everybody is shown the board:
      // a race nobody sees the end of is not a race.
      const mine = id === myId;
      hud.showToast(
        "🏆",
        mine ? "You won!" : `${name} won`,
        `${missions} missions finished. The city carries on — keep helping.`,
      );
      leaderboard.toggle(true);
      syncInput();
    },
    onClosed: () => {
      classmates.clear();
      hud.setLeaderboard(false);
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
    winner = null;
    myId = "me";
    classmates.clear();
    hud.setLeaderboard(false);
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
      const created = new PeerHost(name, appearance, {
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
        onWon: netHandlers.onWon,
      });
      host = created;
      net = created;
      myName = name;
      myId = created.id;
      hud.setLeaderboard(true);
      // Hosting is the one claim to the teacher's panel that cannot be
      // borrowed: the room only exists while this tab does.
      teacher.unlock();
      startMode(MODES.multiplayer);
      created.setMode(MODES.multiplayer.id);
    });
  }

  const lobby = new Lobby(ui, {
    onCharacter: () => {
      character.toggle(true);
      syncInput();
    },
    onHost: (name) => openRoom(name),
    onJoin: (code, name) => {
      leaveRoom();
      myName = name;
      const guest = new PeerGuest(netHandlers, {
        code,
        name,
        look: appearance,
        onStatus: (text) => lobby.setStatus(text),
      });
      net = guest;
      return guest.join();
    },
    onServerJoin: (details) => {
      leaveRoom();
      myName = details.name;
      const client = new NetClient(netHandlers);
      net = client;
      return client.join({
        url: details.url,
        room: details.room,
        name: details.name,
        role: details.asTeacher ? "teacher" : "student",
        look: appearance,
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
        syncInput();
        return;
      }
      startMode(chosen);
    },
    onCharacter: () => {
      character.toggle(true);
      syncInput();
    },
    onQuality: (name) => {
      engine.setQuality(name);
      environment.setShadowQuality(QUALITY[name].shadowMap, QUALITY[name].shadowRadius);
      setTextureAnisotropy(QUALITY[name].anisotropy);
      rememberQuality(name);
    },
    onTeacher: () => teacher.toggle(true),
  });

  const character = new CharacterPanel(ui, appearance, {
    // Live: the character in the city changes as the swatches are tapped, which
    // is the whole reason the panel is worth having over a list of names.
    onChange: (chosen) => {
      appearance = chosen;
      player.setAppearance(chosen);
      saveAppearance(chosen);
    },
    onClose: () => syncInput(),
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
    onSetTarget: (missions) => {
      // The race is a rule of the lesson, not of the network: it works on one
      // laptop too, where the only person racing is the one holding it.
      winTarget = missions;
      winner = null;
      net.setTarget(missions);
      refreshBoard();
      checkMissions();
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
    /** The race, for the smoke test and for a lesson that is misbehaving. */
    winTarget: () => winTarget,
    winner: () => winner,
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
    /**
     * How many trees ended up on a pavement, which must be none.
     *
     * The kerbside planting was taken out because a trunk every few paces made
     * walking down a three-tile pavement a slalom. This is the invariant that
     * says so out loud, so the next change to the planting rules cannot quietly
     * put them back.
     */
    treesOnPavement: (): number =>
      TREE_SPOTS.filter((t) => isSidewalk(Math.floor(t.x), Math.floor(t.z))).length,
    /** Put a body on, from the console or the smoke test. */
    wear: (kind: BodyKind) => character.wearBody(kind),
    /** True once the robot has downloaded and is the body on screen. */
    robotReady: (): boolean => player.wearingRobot,
    /**
     * The open case, for the smoke test and for a lesson that has got stuck.
     *
     * `solve()` answers every clue-carrying citizen the way the student would
     * have, which is how the smoke test walks a whole case without knowing
     * anything about adverbs.
     */
    /** Switch mode from the console or the smoke test, as the menu would. */
    startMode: (id: string) => {
      const next = MODES[id as keyof typeof MODES];
      if (next) startMode(next);
      return mode.id;
    },
    detective: () => detective,
    caseFacts: () => detective?.collected.length ?? 0,
    suspectsLeft: () => detective?.remaining.length ?? 0,
    solve: (): string | null => {
      if (!detective) return null;
      for (const npc of npcs.npcs) {
        if (npc.quest.clue && detective.collect(npc.quest.clue)) state.cluesFound++;
      }
      rememberCase();
      refreshCaseUi();
      return detective.secret.name;
    },
    /**
     * How tall the body currently on screen actually draws, in world units.
     *
     * The other invariant on this list, and the one that was missing when it
     * was needed: the robot shipped scaled to 0.008, four centimetres of
     * character standing on the pavement, and nothing in the build said so
     * because nothing was asking. It is measured through the vertices rather
     * than a bounding box for the reason set out in `characterModel.ts` — a
     * `Box3` around this rig answers 149.
     */
    playerHeight: (): number => {
      const bounds = drawnBounds(player.object);
      return bounds.max - bounds.min;
    },
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
