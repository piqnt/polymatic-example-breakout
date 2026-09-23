import { ImageSource, Rectangle, Texture } from "pixi.js";

import bgSvg from "./assets/bg.svg?raw";
import mainSvg from "./assets/main.svg?raw";

// atlas units per world unit, e.g. a 32 unit brick is 2 world units
export const ATLAS_UNITS = 16;

const MAIN_HEIGHT = 256;
const MAX_RESOLUTION = 8;

export type TextureName =
  | "board"
  | "br"
  | "bg"
  | "bb"
  | "by"
  | "bp"
  | "brs"
  | "bgs"
  | "bbs"
  | "bys"
  | "bps"
  | "paddleFull"
  | "paddleMini"
  | "ball"
  | "+"
  | "-"
  | "restart"
  | `d_${number}`;

export type Textures = Record<TextureName, Texture>;

/**
 * Rasterizes the svg atlases to match the given screen pixels per world unit, and slices them into named textures.
 */
export async function loadTextures(pixelsPerUnit: number): Promise<Textures> {
  const resolution = Math.min(Math.max(Math.ceil(pixelsPerUnit / ATLAS_UNITS), 1), MAX_RESOLUTION);

  const [bg, main] = await Promise.all([loadSvg(bgSvg, resolution), loadSvg(mainSvg, resolution)]);

  // frames are in atlas units, texture source resolution maps them to pixels
  const frame = (source: Texture, x: number, y: number, width: number, height: number) =>
    new Texture({
      source: source.source,
      frame: new Rectangle(x, y, width, height),
    });

  // main atlas frames are measured from the bottom
  const sprite = (x: number, y: number, width: number, height: number) =>
    frame(main, x, MAIN_HEIGHT - (y + height), width, height);

  const textures = {
    board: frame(bg, 0, 0, 320, 416),

    br: sprite(32 * 0, 0, 32, 32),
    bg: sprite(32 * 1, 0, 32, 32),
    bb: sprite(32 * 2, 0, 32, 32),
    by: sprite(32 * 3, 0, 32, 32),
    bp: sprite(32 * 4, 0, 32, 32),

    brs: sprite(160, 0, 16, 16),
    bgs: sprite(176, 0, 16, 16),
    bbs: sprite(192, 0, 16, 16),
    bys: sprite(208, 0, 16, 16),
    bps: sprite(224, 0, 16, 16),

    paddleFull: sprite(0, 32, 48, 16),
    paddleMini: sprite(48, 32, 32, 16),
    ball: sprite(80, 32, 16, 16),
    "+": sprite(96, 32, 16, 16),
    "-": sprite(112, 32, 16, 16),

    restart: sprite(192, 48, 64, 64),
  } as Textures;

  for (let i = 0; i < 10; i++) {
    textures[`d_${i}`] = sprite(16 * i, 48, 16, 16);
  }

  return textures;
}

/**
 * Rasterizes svg markup at the given resolution. The svg is resized with a viewBox before drawing, so the
 * browser renders vectors at full size instead of scaling up a small bitmap.
 */
async function loadSvg(markup: string, resolution: number): Promise<Texture> {
  const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
  const svg = doc.documentElement;
  const width = parseFloat(svg.getAttribute("width"));
  const height = parseFloat(svg.getAttribute("height"));
  const pixelWidth = Math.ceil(width * resolution);
  const pixelHeight = Math.ceil(height * resolution);
  if (!svg.hasAttribute("viewBox")) {
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  }
  svg.setAttribute("width", String(pixelWidth));
  svg.setAttribute("height", String(pixelHeight));

  const image = new Image();
  image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(svg));
  await image.decode();

  const canvas = document.createElement("canvas");
  canvas.width = pixelWidth;
  canvas.height = pixelHeight;
  canvas.getContext("2d").drawImage(image, 0, 0, pixelWidth, pixelHeight);

  const source = new ImageSource({
    resource: canvas,
    resolution,
    alphaMode: "premultiply-alpha-on-upload",
    // smooth downscaling when the window is smaller than the rasterized size
    autoGenerateMipmaps: true,
  });
  return new Texture({ source });
}
