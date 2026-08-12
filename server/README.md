# The class server

Da World is a static site: one browser, one city, no server. That is the right
shape for a student practising at home, and it is why the game works from
GitHub Pages with nothing behind it.

**Class mode** is the exception, and it is the one thing a static site cannot
do on its own. Twelve students and a teacher walking around the same city need
something in the middle to pass positions through, so this folder holds it: a
small WebSocket relay, about two hundred lines, with no database and nothing to
configure but a passphrase.

```bash
cd server
npm install
DA_WORLD_TEACHER_PASSPHRASE="something only you know" npm start
```

It prints the address students connect to. In the game, choose **Class**, enter
that address and a name, and you are in the same city.

## What it does and does not do

It does **not** simulate the city. Every browser already has the whole of it —
the street grid, the ninety-one places, the quest generator and the grammar
bank — and they all derive the same questions from the same tables with the
same seeds. So nothing about the world is ever sent; two students standing
outside the bakery are looking at the same bakery because they built it from
the same data, not because a server told them to.

What it does is keep the guest list and forward the four things a browser
cannot work out alone:

| | |
| --- | --- |
| where everybody is | ten times a second, batched into one message per tick |
| how everybody is doing | score and citizens helped, for the teacher's panel |
| the room's mission | set by the teacher, shown at the top of every screen |
| the room's mode | Vocabulary or Directions, for everybody at once |

## The passphrase

`DA_WORLD_TEACHER_PASSPHRASE` is checked **here**, on the server, and is never
sent to any student's browser. That makes it a real lock, unlike the passphrase
compiled into the page (see `src/ui/teacher.ts`), which only stops a curious
student opening the panel by accident. If a student edits their own copy of the
game and claims to be a teacher, the server refuses the join — and the two
teacher commands are checked by role on arrival, not trusted from the message.

Set it before a real lesson. The server prints a warning if you leave it on the
default.

## Running it somewhere

- **One classroom, one machine.** Run it on the teacher's laptop. Students on
  the same wifi connect to `ws://<the laptop's IP>:8787`. Nothing leaves the
  room.
- **A whole school.** Put it on any host that runs node and speaks WebSockets
  and give students the public address. Behind TLS the address becomes `wss://`.
- **GitHub Pages.** Pages serves static files only, so it cannot host this. The
  game itself still runs there — Vocabulary and Directions need no server at
  all; only Class does.

## Limits

`MAX_STUDENTS` is 12 and one teacher, matching what the room is designed for.
It is a constant at the top of `index.js` and in `src/net/protocol.ts`; if you
raise it, raise both.

A room exists while somebody is in it and is thrown away when the last person
leaves, which is the whole lifecycle a lesson needs: no database, no cleanup
job, and nothing to reset between classes.
