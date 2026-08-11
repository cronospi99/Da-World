# Character model

`character.glb` — **RobotExpressive**

- Model by [Tomás Laulhé](https://www.patreon.com/quaternius) (Quaternius).
- Modifications by [Don McCurdy](https://donmccurdy.com/): facial morph targets,
  converted with FBX2GLTF, duplicate materials removed.
- **Licence: CC0 1.0** (public domain dedication). Obtained from the three.js
  repository, `examples/models/gltf/RobotExpressive/`.

If you use this in something you ship, consider supporting the creator's Patreon.

## Swapping it out

The game loads whatever GLB sits at this path. To use a different character,
replace the file and check `src/game/characterModel.ts`:

- `TARGET_HEIGHT` scales the model to the world; it is applied from the model's
  own bounding box, so any size of source model works.
- `CLIPS` maps the game's states to animation names. Rename the entries to match
  whatever your model's clips are called.
- `FACING_OFFSET` rotates the model if it does not face +Z in its bind pose.
