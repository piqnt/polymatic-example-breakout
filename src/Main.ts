import { type Application, type Container } from "pixi.js";

import { Middleware } from "polymatic";

import { FrameLoop } from "./FrameLoop";
import { PixiManager } from "./PixiManager";
import { Terminal } from "./Terminal";
import { Physics } from "./Physics";
import { Board, type Ball, type Brick, type Drop, type Paddle, type Wall } from "./Board";

export interface MainContext {
  pixi?: Application;
  scene?: Container;

  // keys currently pressed, by KeyboardEvent.code
  activeKeys?: Record<string, boolean>;

  paddle?: Paddle | null;
  balls?: Ball[];
  bricks?: Brick[];
  drops?: Drop[];
  walls?: Wall[];

  state?: "ready" | "playing" | "gameover";
  score?: number;
  combo?: number;
}

export class Main extends Middleware<MainContext> {
  constructor() {
    super();
    this.use(new FrameLoop());
    this.use(new PixiManager());
    this.on("pixi-ready", this.handlePixiReady);
  }

  handlePixiReady = () => {
    this.use(new Board());
    this.use(new Physics());
    this.use(new Terminal());
  };
}
