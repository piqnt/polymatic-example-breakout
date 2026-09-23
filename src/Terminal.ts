import { Container, Sprite, Text, type Texture } from "pixi.js";

import { Binder, Driver, Middleware } from "polymatic";

import { type MainContext } from "./Main";
import { type Ball, type Brick, type Drop, type Entity, type Paddle, BOARD_HEIGHT, BOARD_WIDTH } from "./Board";
import { loadTextures, type TextureName, type Textures } from "./Textures";

const BRICK_COLORS = ["r", "g", "b", "y", "p"];

// sprite sizes in world units, the atlas has 16 texture units per world unit
const BOARD_SPRITE = { width: 20, height: 26 };
const DIGIT_SIZE = 1;
const RESTART_SIZE = 4;
const HINT_SIZE = 0.5;

// paddle textures are wider than their physics shapes, center them on the shape
const PADDLE_SPRITES = {
  full: { width: 3.6, height: 1.2, y: 0.2 },
  mini: { width: 2.4, height: 1.2, y: 0.25 },
};

/**
 * Terminal: renders game data with Pixi, and reads keyboard and pointer input.
 */
export class Terminal extends Middleware<MainContext> {
  textures: Textures | null = null;

  // entity sprites, between the board and the overlays
  layer: Container;
  status: Text;
  score: Container;
  restart: Sprite;

  constructor() {
    super();
    this.on("activate", this.handleActivate);
    this.on("deactivate", this.handleDeactivate);
    this.on("frame-render", this.handleFrameRender);
  }

  handleActivate = async () => {
    const pixi = this.context.pixi;
    const scene = this.context.scene;

    this.context.activeKeys = {};

    pixi.renderer.on("resize", this.handleViewport);
    this.handleViewport();

    document.addEventListener("keydown", this.handleKeydown);
    document.addEventListener("keyup", this.handleKeyup);

    // rasterize for the largest the board can be on this screen, in either orientation
    const { width, height } = window.screen;
    const fit = (w: number, h: number) => Math.min(w / BOARD_WIDTH, h / BOARD_HEIGHT);
    const pixelsPerUnit = Math.max(fit(width, height), fit(height, width)) * (window.devicePixelRatio || 1);
    const textures = await loadTextures(pixelsPerUnit);

    scene.addChild(makeSprite(textures.board, BOARD_SPRITE.width, BOARD_SPRITE.height));

    this.layer = new Container();
    scene.addChild(this.layer);

    this.score = new Container();
    this.score.position.set(0, BOARD_SPRITE.height / 2 + DIGIT_SIZE / 2);
    scene.addChild(this.score);

    this.restart = makeSprite(textures.restart, RESTART_SIZE, RESTART_SIZE);
    this.restart.eventMode = "static";
    this.restart.cursor = "pointer";
    this.restart.on("pointertap", () => this.emit("user-fire"));
    scene.addChild(this.restart);

    // hint below the board, text is drawn large and scaled down to world units
    this.status = new Text({
      text: "← → move    space restart",
      style: { fill: 0x9d9d9d, fontFamily: "monospace", fontSize: 32 },
    });
    this.status.anchor.set(0.5);
    this.status.scale.set(HINT_SIZE / 32, -HINT_SIZE / 32);
    this.status.position.set(0, -BOARD_SPRITE.height / 2 - HINT_SIZE);
    scene.addChild(this.status);

    this.textures = textures;
  };

  handleDeactivate = () => {
    this.context.pixi?.renderer.off("resize", this.handleViewport);
    document.removeEventListener("keydown", this.handleKeydown);
    document.removeEventListener("keyup", this.handleKeyup);
  };

  /**
   * Fit the board inside the screen, center the origin, and flip y-axis to point up like physics.
   */
  handleViewport = () => {
    const pixi = this.context.pixi;
    const scene = this.context.scene;

    const screenWidth = pixi.screen.width;
    const screenHeight = pixi.screen.height;

    const scale = Math.min(screenWidth / BOARD_WIDTH, screenHeight / BOARD_HEIGHT);
    scene.scale.set(scale, -scale);
    scene.position.set(screenWidth / 2, screenHeight / 2);
  };

  handleKeydown = (e: KeyboardEvent) => {
    if (!isGameKey(e.code)) return;
    e.preventDefault();
    this.context.activeKeys[e.code] = true;
    if (e.code === "Space") {
      this.emit("user-fire");
    }
  };

  handleKeyup = (e: KeyboardEvent) => {
    if (!isGameKey(e.code)) return;
    e.preventDefault();
    this.context.activeKeys[e.code] = false;
  };

  handleFrameRender = () => {
    if (!this.textures) return;

    const { balls, bricks, drops, paddle, score, state } = this.context;
    this.binder.setData([...bricks, ...drops, ...balls, paddle]);

    this.renderScore(score);
    this.restart.visible = state === "gameover";
  };

  renderedScore = -1;

  renderScore(score: number) {
    if (score === this.renderedScore) return;
    this.renderedScore = score;

    this.score.removeChildren().forEach((child) => child.destroy());
    const digits = String(score);
    for (let i = 0; i < digits.length; i++) {
      const digit = makeSprite(this.textures[`d_${digits[i]}` as TextureName], DIGIT_SIZE, DIGIT_SIZE);
      digit.x = (i - (digits.length - 1) / 2) * DIGIT_SIZE;
      this.score.addChild(digit);
    }
  }

  brickDriver = Driver.create<Brick, Sprite>({
    filter: (data) => data.type === "brick",
    enter: (data) => {
      const color = BRICK_COLORS[Math.floor(Math.random() * BRICK_COLORS.length)];
      const sprite =
        data.size === "small"
          ? makeSprite(this.textures[`b${color}s` as TextureName], 1, 1)
          : makeSprite(this.textures[`b${color}` as TextureName], 2, 2);
      this.layer.addChild(sprite);
      return sprite;
    },
    update: (data, sprite) => {
      sprite.position.set(data.x, data.y);
    },
    exit: (data, sprite) => {
      sprite.removeFromParent();
      sprite.destroy();
    },
  });

  dropDriver = Driver.create<Drop, Sprite>({
    filter: (data) => data.type === "drop",
    enter: (data) => {
      const sprite = makeSprite(this.textures[data.value], 1, 1);
      this.layer.addChild(sprite);
      return sprite;
    },
    update: (data, sprite) => {
      sprite.position.set(data.x, data.y);
    },
    exit: (data, sprite) => {
      sprite.removeFromParent();
      sprite.destroy();
    },
  });

  ballDriver = Driver.create<Ball, Sprite>({
    filter: (data) => data.type === "ball",
    enter: (data) => {
      const sprite = makeSprite(this.textures.ball, 1, 1);
      this.layer.addChild(sprite);
      return sprite;
    },
    update: (data, sprite) => {
      sprite.position.set(data.x, data.y);
    },
    exit: (data, sprite) => {
      sprite.removeFromParent();
      sprite.destroy();
    },
  });

  paddleDriver = Driver.create<Paddle, Sprite>({
    filter: (data) => data.type === "paddle",
    enter: (data) => {
      const size = PADDLE_SPRITES[data.size];
      const texture = data.size === "mini" ? this.textures.paddleMini : this.textures.paddleFull;
      const sprite = makeSprite(texture, size.width, size.height);
      this.layer.addChild(sprite);
      return sprite;
    },
    update: (data, sprite) => {
      sprite.position.set(data.x, data.y + PADDLE_SPRITES[data.size].y);
    },
    exit: (data, sprite) => {
      sprite.removeFromParent();
      sprite.destroy();
    },
  });

  binder = Binder.create<Entity>({
    key: (data) => data.key,
    drivers: [this.brickDriver, this.dropDriver, this.ballDriver, this.paddleDriver],
  });
}

/** Centered sprite with size in world units, flipped back upright in the y-up scene. */
function makeSprite(texture: Texture, width: number, height: number) {
  const sprite = new Sprite(texture);
  sprite.anchor.set(0.5);
  sprite.scale.set(width / texture.width, -height / texture.height);
  return sprite;
}

const GAME_KEYS = new Set(["ArrowLeft", "ArrowRight", "Space"]);

function isGameKey(code: string) {
  return GAME_KEYS.has(code);
}
