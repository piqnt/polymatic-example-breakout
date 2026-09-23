import { Application, Container } from "pixi.js";

import { Middleware } from "polymatic";

import { type MainContext } from "./Main";
import { type FrameLoopEvent } from "./FrameLoop";

/**
 * Creates and owns the Pixi application, and drives Pixi's ticker from the
 * FrameLoop so there is a single loop.
 */
export class PixiManager extends Middleware<MainContext> {
  constructor() {
    super();
    this.on("activate", this.handleActivate);
    this.on("deactivate", this.handleDeactivate);
    this.on("frame-after", this.handleFrameAfter);
  }

  handleActivate = async () => {
    const pixi = new Application();
    await pixi.init({
      resizeTo: window,
      backgroundAlpha: 0,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      antialias: true,
      // ticker is updated manually in handleFrameAfter, see FrameLoop
      autoStart: false,
    });
    document.body.appendChild(pixi.canvas);

    // scene container, scaled and centered by Terminal to fit the viewbox
    const scene = new Container();
    pixi.stage.addChild(scene);

    this.setContext((context) => {
      context.pixi = pixi;
      context.scene = scene;
    });
    this.emit("pixi-ready");
  };

  handleDeactivate = () => {
    this.context.pixi?.destroy({ removeView: true }, { children: true });
  };

  handleFrameAfter = (ev: FrameLoopEvent) => {
    if (!this.context.pixi) return;
    // runs ticker listeners and then renders the stage
    this.context.pixi.ticker.update(ev.now);
  };
}
