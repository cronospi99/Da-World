import * as THREE from "three";

/**
 * The look.
 *
 * Nothing here is physically based. Every surface is shaded by looking up a
 * hand-authored gradient ("ramp") with `dot(N, L)` remapped to 0..1, exactly
 * like the reference world does: shadows are a different *hue*, not just a
 * darker version of the lit colour. On top of that every material gets
 * drifting cloud shadows and, optionally, wind sway.
 *
 * Implementation note: `MeshToonMaterial` already samples a gradient map with
 * `dot(N, L) * 0.5 + 0.5`, but stock three.js throws away everything except the
 * red channel. A one-line patch to `getGradientIrradiance` gives us full RGB
 * ramps, and a second patch lets each material pick its own row of the atlas.
 */

export const RAMP_ROWS = {
  /** Neutral: cool violet shadow into warm cream light. */
  default: 0,
  /** Foliage: deep teal shadow into sunlit yellow-green. */
  foliage: 1,
  /** Cloth, paper, sails — low contrast, stays bright. */
  soft: 2,
  /** Stone and dirt — desaturated, slightly blue. */
  stone: 3,
  /** Skin — warm even in shadow. */
  skin: 4,
} as const;

export type RampRow = keyof typeof RAMP_ROWS;

const RAMP_WIDTH = 128;
const RAMP_ROW_COUNT = Object.keys(RAMP_ROWS).length;

/**
 * Each row is a list of colour stops sampled across `dot(N, L)`.
 * Stop 0 is fully turned away from the sun, stop 1 faces it directly.
 */
const RAMP_STOPS: Record<RampRow, Array<[number, string]>> = {
  default: [
    [0.0, "#535a8c"],
    [0.42, "#9a93a8"],
    [0.5, "#c9bda9"],
    [0.72, "#efe0c4"],
    [1.0, "#fff6e0"],
  ],
  foliage: [
    [0.0, "#2f4d64"],
    [0.4, "#5f7d6a"],
    [0.5, "#93ab72"],
    [0.75, "#d3d894"],
    [1.0, "#f6f0bc"],
  ],
  soft: [
    [0.0, "#9a95b4"],
    [0.45, "#c4bcc0"],
    [0.55, "#eadfcb"],
    [1.0, "#fffaef"],
  ],
  stone: [
    [0.0, "#5b6288"],
    [0.45, "#9d9ca6"],
    [0.55, "#cbc4bb"],
    [1.0, "#f3ece0"],
  ],
  skin: [
    [0.0, "#96718c"],
    [0.45, "#c99a90"],
    [0.55, "#eec5a4"],
    [1.0, "#fff0d8"],
  ],
};

let rampTexture: THREE.Texture | null = null;

/** Builds the ramp atlas: one row per entry in RAMP_ROWS. */
function getRampTexture(): THREE.Texture {
  if (rampTexture) return rampTexture;

  const canvas = document.createElement("canvas");
  canvas.width = RAMP_WIDTH;
  canvas.height = RAMP_ROW_COUNT;
  const ctx = canvas.getContext("2d")!;

  for (const [name, row] of Object.entries(RAMP_ROWS)) {
    const gradient = ctx.createLinearGradient(0, 0, RAMP_WIDTH, 0);
    for (const [offset, color] of RAMP_STOPS[name as RampRow]) {
      gradient.addColorStop(offset, color);
    }
    ctx.fillStyle = gradient;
    ctx.fillRect(0, row, RAMP_WIDTH, 1);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  rampTexture = texture;
  return texture;
}

let cloudTexture: THREE.Texture | null = null;

/** Soft tiling blobs, used as the drifting cloud shadow map. */
function getCloudTexture(): THREE.Texture {
  if (cloudTexture) return cloudTexture;

  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);

  // Blobs are drawn nine times (3x3) so the texture tiles seamlessly.
  ctx.globalCompositeOperation = "multiply";
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 22 + Math.random() * 46;
    const depth = 0.45 + Math.random() * 0.35;
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const gradient = ctx.createRadialGradient(
          x + ox * size,
          y + oy * size,
          0,
          x + ox * size,
          y + oy * size,
          r,
        );
        const shade = Math.round(255 * (1 - depth));
        gradient.addColorStop(0, `rgb(${shade},${shade},${shade})`);
        gradient.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x + ox * size, y + oy * size, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  cloudTexture = texture;
  return texture;
}

/** Uniforms shared by every patched material — updated once per frame. */
export const sharedUniforms = {
  uTime: { value: 0 },
  uCloudMap: { value: null as THREE.Texture | null },
  uCloudScale: { value: 0.006 },
  uCloudSpeed: { value: new THREE.Vector2(0.0045, 0.0022) },
  uCloudStrength: { value: 0.34 },
  /** World position of the player, so grass can lean away from them. */
  uPlayerPos: { value: new THREE.Vector3() },
};

export interface ToonOptions {
  color?: THREE.ColorRepresentation;
  ramp?: RampRow;
  /** Sway in the wind. `windHeight` is the object-space height of the top. */
  wind?: boolean;
  windStrength?: number;
  windHeight?: number;
  /** Bend away from the player (grass). */
  reactToPlayer?: boolean;
  /** Fade out beyond this distance from the camera. */
  fadeAway?: number;
  vertexColors?: boolean;
  flatShading?: boolean;
  transparent?: boolean;
  alphaTest?: number;
  side?: THREE.Side;
  map?: THREE.Texture | null;
}

/**
 * Creates a ramp-shaded material. Every visible surface in the game should go
 * through here so the whole world shades as one system.
 */
export function toonMaterial(options: ToonOptions = {}): THREE.MeshToonMaterial {
  const {
    color = "#ffffff",
    ramp = "default",
    wind = false,
    windStrength = 0.06,
    windHeight = 4,
    reactToPlayer = false,
    fadeAway = 0,
    vertexColors = false,
    flatShading = false,
    transparent = false,
    alphaTest = 0,
    side = THREE.FrontSide,
    map = null,
  } = options;

  const material = new THREE.MeshToonMaterial({
    color,
    gradientMap: getRampTexture(),
    vertexColors,
    transparent,
    alphaTest,
    side,
    map,
  });
  // MeshToonMaterial does not declare `flatShading`, but the renderer reads it
  // off the material object generically (WebGLPrograms) and the toon shader
  // honours FLAT_SHADED, so setting it here does work.
  (material as unknown as { flatShading: boolean }).flatShading = flatShading;

  sharedUniforms.uCloudMap.value ??= getCloudTexture();

  const rampRow = (RAMP_ROWS[ramp] + 0.5) / RAMP_ROW_COUNT;

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = sharedUniforms.uTime;
    shader.uniforms.uCloudMap = sharedUniforms.uCloudMap;
    shader.uniforms.uCloudScale = sharedUniforms.uCloudScale;
    shader.uniforms.uCloudSpeed = sharedUniforms.uCloudSpeed;
    shader.uniforms.uCloudStrength = sharedUniforms.uCloudStrength;
    shader.uniforms.uPlayerPos = sharedUniforms.uPlayerPos;
    shader.uniforms.uRampRow = { value: rampRow };
    shader.uniforms.uWindStrength = { value: windStrength };
    shader.uniforms.uWindHeight = { value: windHeight };
    shader.uniforms.uFadeAway = { value: fadeAway };

    // ---- vertex ----------------------------------------------------------
    shader.vertexShader = `
      uniform float uTime;
      uniform float uWindStrength;
      uniform float uWindHeight;
      uniform vec3 uPlayerPos;
      varying vec3 vWorldPosDW;
      ${shader.vertexShader}
    `;

    let vertexInjection = "";
    if (wind) {
      vertexInjection += /* glsl */ `
        {
          vec3 anchor = ( modelMatrix
            #ifdef USE_INSTANCING
              * instanceMatrix
            #endif
            * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
          // Taller parts of the object sway further.
          float bendMask = clamp( position.y / uWindHeight, 0.0, 1.0 );
          bendMask *= bendMask;
          float phase = uTime * 1.7 + anchor.x * 0.32 + anchor.z * 0.27;
          float gust = 0.65 + 0.35 * sin( uTime * 0.4 + anchor.x * 0.05 );
          transformed.x += sin( phase ) * bendMask * uWindStrength * gust;
          transformed.z += cos( phase * 0.87 ) * bendMask * uWindStrength * 0.7 * gust;
        }
      `;
    }
    if (reactToPlayer) {
      vertexInjection += /* glsl */ `
        {
          vec3 anchor = ( modelMatrix
            #ifdef USE_INSTANCING
              * instanceMatrix
            #endif
            * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
          vec3 away = anchor - uPlayerPos;
          away.y = 0.0;
          float d = length( away );
          float push = smoothstep( 2.2, 0.0, d ) * clamp( position.y / uWindHeight, 0.0, 1.0 );
          transformed.xz += normalize( away + vec3( 0.001, 0.0, 0.0 ) ).xz * push * 0.9;
          transformed.y -= push * 0.25;
        }
      `;
    }

    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>\n${vertexInjection}`,
    );

    shader.vertexShader = shader.vertexShader.replace(
      "#include <project_vertex>",
      /* glsl */ `
        vWorldPosDW = ( modelMatrix
          #ifdef USE_INSTANCING
            * instanceMatrix
          #endif
          * vec4( transformed, 1.0 ) ).xyz;
        #include <project_vertex>
      `,
    );

    // ---- fragment --------------------------------------------------------
    shader.fragmentShader = `
      uniform float uTime;
      uniform sampler2D uCloudMap;
      uniform float uCloudScale;
      uniform vec2 uCloudSpeed;
      uniform float uCloudStrength;
      uniform float uRampRow;
      uniform float uFadeAway;
      varying vec3 vWorldPosDW;
      ${shader.fragmentShader}
    `;

    // Full-colour ramps, indexed by this material's row of the atlas.
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "vec2 coord = vec2( dotNL * 0.5 + 0.5, 0.0 );",
        "vec2 coord = vec2( dotNL * 0.5 + 0.5, uRampRow );",
      )
      .replace(
        "return vec3( texture2D( gradientMap, coord ).r );",
        "return texture2D( gradientMap, coord ).rgb;",
      );

    // Drifting cloud shadows, plus optional distance fade.
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <opaque_fragment>",
      /* glsl */ `
        {
          vec2 cloudUv = vWorldPosDW.xz * uCloudScale + uCloudSpeed * uTime;
          float clouds = texture2D( uCloudMap, cloudUv ).r;
          outgoingLight *= mix( 1.0, clouds, uCloudStrength );
        }
        #include <opaque_fragment>
      `,
    );

    if (fadeAway > 0) {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <opaque_fragment>",
        /* glsl */ `
          diffuseColor.a *= 1.0 - smoothstep( uFadeAway * 0.65, uFadeAway, length( vWorldPosDW - cameraPosition ) );
          #include <opaque_fragment>
        `,
      );
    }
  };

  // Materials with different injected code must not share a program.
  material.customProgramCacheKey = () =>
    `dw:${ramp}:${wind ? 1 : 0}:${reactToPlayer ? 1 : 0}:${fadeAway > 0 ? 1 : 0}`;

  return material;
}

/** Advance the shared animation uniforms. Call once per frame. */
export function updateMaterials(elapsed: number, playerPosition: THREE.Vector3): void {
  sharedUniforms.uTime.value = elapsed;
  sharedUniforms.uPlayerPos.value.copy(playerPosition);
}
