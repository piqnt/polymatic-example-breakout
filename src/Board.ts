import { Middleware } from "polymatic";

import { type MainContext } from "./Main";
import { type FrameLoopEvent } from "./FrameLoop";
import { Util } from "./Util";

export const BOARD_WIDTH = 20;
export const BOARD_HEIGHT = 28;

// inner half width of the board, between side walls
export const BOARD_HALF_WIDTH = 9;

const BOARD_ROWS = 10;
const BOARD_COLUMNS = 7;

const PADDLE_SPEED = 18;
const DROP_SPEED = -6;
const RESET_PADDLE_TIME = 7500;
const MAX_FRAME_TIME = 50;

export const BALL_RADIUS = 0.5;

export const BRICK_SIZES = {
  normal: 1.9,
  small: 0.9,
};

export const PADDLE_PATHS = {
  full: [
    { x: 1.7, y: -0.2 },
    { x: 1.8, y: -0.1 },
    { x: 1.8, y: 0.1 },
    { x: 1.7, y: 0.2 },
    { x: 1.2, y: 0.4 },
    { x: 0.4, y: 0.6 },
    { x: -0.4, y: 0.6 },
    { x: -1.2, y: 0.4 },
    { x: -1.7, y: 0.2 },
    { x: -1.8, y: 0.1 },
    { x: -1.8, y: -0.1 },
    { x: -1.7, y: -0.2 },
  ],
  mini: [
    { x: 1.2, y: -0.1 },
    { x: 1.2, y: 0.1 },
    { x: 0.9, y: 0.4 },
    { x: 0.2, y: 0.6 },
    { x: -0.2, y: 0.6 },
    { x: -0.9, y: 0.4 },
    { x: -1.2, y: 0.1 },
    { x: -1.2, y: -0.1 },
  ],
};

export const PADDLE_HALF_WIDTHS = {
  full: 1.8,
  mini: 1.2,
};

export interface Point {
  x: number;
  y: number;
}

export interface Ball {
  key: string;
  type: "ball";
  // position and velocity, updated by physics
  x: number;
  y: number;
  velocity: Point;
}

export interface Brick {
  key: string;
  type: "brick";
  size: "normal" | "small";
  // grid position, rows move down as new rows are added
  i: number;
  j: number;
  x: number;
  y: number;
}

export interface Drop {
  key: string;
  type: "drop";
  value: "+" | "-";
  speed: number;
  // position, updated by physics
  x: number;
  y: number;
}

export interface Paddle {
  key: string;
  type: "paddle";
  size: "mini" | "full";
  speed: number;
  // position, updated by physics
  x: number;
  y: number;
}

export interface Wall {
  key: string;
  type: "wall";
  floor?: boolean;
  // edge line segment
  path: [Point, Point];
}

export type Entity = Ball | Brick | Drop | Paddle | Wall;

/**
 * Game logic: rules, lifecycles and timers. Physics and rendering agnostic.
 */
export class Board extends Middleware<MainContext> {
  globalTime = 0;
  nextRowTime = 0;
  resetPaddleTime = 0;

  constructor() {
    super();
    this.on("activate", this.handleActivate);
    this.on("game-start", this.handleGameStart);
    this.on("user-fire", this.handleUserFire);
    this.on("frame-update", this.handleFrameUpdate);

    this.on("collide-ball-brick", this.handleCollideBallBrick);
    this.on("collide-ball-bottom", this.handleCollideBallBottom);
    this.on("collide-ball-paddle", this.handleCollideBallPaddle);
    this.on("collide-drop-paddle", this.handleCollideDropPaddle);
    this.on("collide-drop-bottom", this.handleCollideDropBottom);
  }

  getBallSpeed() {
    return (13 + this.context.score * 0.05) * 0.7;
  }

  getNextRowTime() {
    return Math.max(8000 - 20 * this.context.score, 1000);
  }

  handleActivate = () => {
    this.context.state = "gameover";
    this.context.score = 0;
    this.context.combo = 1;

    this.context.balls = [];
    this.context.bricks = [];
    this.context.drops = [];
    this.context.paddle = null;
    this.context.walls = makeWalls();

    this.emit("game-start");
  };

  handleGameStart = () => {
    this.context.state = "playing";
    this.context.score = 0;
    this.context.combo = 1;

    this.nextRowTime = 0;
    this.resetPaddleTime = 0;

    this.context.bricks.length = 0;
    this.context.balls.length = 0;
    this.context.drops.length = 0;
    this.context.paddle = null;

    this.setPaddle("full");
    this.addBall();
    this.addRow();
    this.addRow();
    this.addRow();
  };

  handleUserFire = () => {
    if (this.context.state === "gameover") {
      this.emit("game-start");
    }
  };

  end() {
    this.context.state = "gameover";
    this.context.paddle = null;
    this.context.balls.length = 0;
    this.context.drops.length = 0;
  }

  handleFrameUpdate = (ev: FrameLoopEvent) => {
    if (this.context.state !== "playing") return;

    this.globalTime += Math.min(ev.dt, MAX_FRAME_TIME);
    if (this.nextRowTime && this.globalTime > this.nextRowTime) {
      this.nextRowTime = 0;
      this.addRow();
    }
    if (this.resetPaddleTime && this.globalTime > this.resetPaddleTime) {
      this.resetPaddleTime = 0;
      this.setPaddle("full");
    }
    this.movePaddle();
  };

  movePaddle() {
    const { paddle, activeKeys } = this.context;
    if (!paddle) return;

    const left = activeKeys["ArrowLeft"];
    const right = activeKeys["ArrowRight"];
    if (left && !right) {
      paddle.speed = -PADDLE_SPEED;
    } else if (right && !left) {
      paddle.speed = +PADDLE_SPEED;
    } else {
      paddle.speed = 0;
    }
  }

  setPaddle(size: "mini" | "full") {
    const paddle = this.context.paddle;

    // new key, so the paddle is recreated with the new shape
    this.context.paddle = {
      key: "paddle-" + Math.random(),
      type: "paddle",
      size: size,
      speed: paddle?.speed ?? 0,
      x: paddle?.x ?? 0,
      y: paddle?.y ?? -10.5,
    };

    if (size == "mini") {
      this.resetPaddleTime = this.globalTime + RESET_PADDLE_TIME;
    }
  }

  addBall() {
    const speed = this.getBallSpeed();

    // new balls split from the last ball, in the opposite direction
    const ball = this.context.balls[this.context.balls.length - 1];
    let velocity: Point;
    if (ball) {
      velocity = { x: -ball.velocity.x, y: -ball.velocity.y };
    } else {
      const a = Math.PI * Math.random() * 0.4 - 0.2;
      velocity = { x: speed * Math.sin(a), y: speed * Math.cos(a) };
    }

    this.context.balls.push({
      key: "ball-" + Math.random(),
      type: "ball",
      x: ball?.x ?? 0,
      y: ball?.y ?? -5,
      velocity,
    });
  }

  addDrop(x: number, y: number) {
    this.context.drops.push({
      key: "drop-" + Math.random(),
      type: "drop",
      value: Math.random() < 0.6 ? "+" : "-",
      speed: DROP_SPEED,
      x,
      y,
    });
  }

  addBrick(size: "normal" | "small", i: number, j: number) {
    this.context.bricks.push({
      key: "brick-" + Math.random(),
      type: "brick",
      size,
      i,
      j,
      x: gridX(i),
      y: gridY(j),
    });
  }

  addRow() {
    this.nextRowTime = this.globalTime + this.getNextRowTime();

    const bricks = this.context.bricks;
    for (let i = 0; i < bricks.length; i++) {
      const brick = bricks[i];
      brick.j++;
      brick.y = gridY(brick.j);
    }

    const score = this.context.score;
    for (let i = 0; i < BOARD_COLUMNS; i++) {
      if (Math.random() < 0.1) {
        continue;
      }
      const oneChance = score + 1;
      const fourChance = Math.max(0, score * 1.1 - 60);
      if (Math.random() < oneChance / (fourChance + oneChance)) {
        this.addBrick("normal", i, 0);
      } else {
        this.addBrick("small", i - 0.25, -0.25);
        this.addBrick("small", i + 0.25, -0.25);
        this.addBrick("small", i - 0.25, +0.25);
        this.addBrick("small", i + 0.25, +0.25);
      }
    }

    for (let i = 0; i < bricks.length; i++) {
      if (bricks[i].j >= BOARD_ROWS) {
        this.end();
        break;
      }
    }
  }

  handleCollideBallBrick = ({ brick }: { ball: Ball; brick: Brick }) => {
    if (this.context.state !== "playing") return;
    if (!Util.removeFromArray(this.context.bricks, brick)) return;

    if (!this.context.bricks.length) {
      this.addRow();
    }
    this.addDrop(brick.x, brick.y);

    this.context.score += this.context.combo;
    this.context.combo++;
  };

  handleCollideBallPaddle = () => {
    this.context.combo = 1;
  };

  handleCollideBallBottom = ({ ball }: { ball: Ball }) => {
    if (!Util.removeFromArray(this.context.balls, ball)) return;

    if (!this.context.balls.length && this.context.state === "playing") {
      this.end();
    }
  };

  handleCollideDropPaddle = ({ drop }: { drop: Drop }) => {
    if (this.context.state !== "playing") return;
    if (!Util.removeFromArray(this.context.drops, drop)) return;

    if (drop.value == "+") {
      this.addBall();
    } else if (drop.value == "-") {
      this.setPaddle("mini");
    }
  };

  handleCollideDropBottom = ({ drop }: { drop: Drop }) => {
    Util.removeFromArray(this.context.drops, drop);
  };
}

function gridX(i: number) {
  return (i - 3) * 2;
}

function gridY(j: number) {
  return 9 - j * 2;
}

function makeWalls(): Wall[] {
  const wall = (key: string, x1: number, y1: number, x2: number, y2: number, floor = false): Wall => ({
    key: "wall-" + key,
    type: "wall",
    floor,
    path: [
      { x: x1, y: y1 },
      { x: x2, y: y2 },
    ],
  });
  const w = BOARD_HALF_WIDTH;
  return [
    wall("left", -w, -13, -w, 11),
    wall("right", w, -13, w, 11),
    wall("top", -8, 12, 8, 12),
    wall("top-left", -w, 11, -8, 12),
    wall("top-right", w, 11, 8, 12),
    wall("floor", -w, -13, w, -13, true),
  ];
}
