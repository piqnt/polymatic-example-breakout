import { Binder, Driver, Middleware } from "polymatic";

import { type MainContext } from "./Main";
import { type FrameLoopEvent } from "./FrameLoop";
import {
  type Ball,
  type Brick,
  type Drop,
  type Entity,
  type Paddle,
  type Point,
  type Wall,
  BALL_RADIUS,
  BOARD_HALF_WIDTH,
  BRICK_SIZES,
  PADDLE_HALF_WIDTHS,
  PADDLE_PATHS,
} from "./Board";

// longest single step in seconds, keeps fast balls from passing through thin shapes
const MAX_STEP = 1 / 240;
const MAX_FRAME_TIME = 50;

const DROP_RADIUS = 0.3;

type Segment = [Point, Point];

/** Moving circle, used for balls and drops. */
interface Circle {
  data: Ball | Drop;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  // drops only report their first contact, the game removes them later
  reported?: boolean;
}

/** Static or kinematic outline, used for bricks, paddle and walls. */
interface Shape {
  data: Brick | Paddle | Wall;
  x: number;
  y: number;
  vx: number;
  // outline in local coordinates, closed shapes have 3 or more segments
  segments: Segment[];
  // bounding radius around x, y, for early out
  bound: number;
}

interface Hit {
  // contact normal, pointing from shape to circle
  nx: number;
  ny: number;
  depth: number;
}

/**
 * Physics: minimal circle vs line-segment physics. Maps game data to bodies, moves them, bounces balls,
 * and turns contacts into game events.
 */
export class Physics extends Middleware<MainContext> {
  circles: Circle[] = [];
  shapes: Shape[] = [];

  constructor() {
    super();
    this.on("frame-update", this.handleFrameUpdate);
  }

  handleFrameUpdate = (ev: FrameLoopEvent) => {
    const { balls, bricks, drops, paddle, walls } = this.context;
    this.binder.setData([...walls, ...bricks, ...drops, ...balls, paddle]);

    // step by the actual frame time, a fixed time step would move 0 or 2 steps on uneven frames and stutter
    const dt = Math.min(ev.dt, MAX_FRAME_TIME) / 1000;
    const steps = Math.ceil(dt / MAX_STEP);
    for (let i = 0; i < steps; i++) {
      this.step(dt / steps);
    }

    // copy position and velocity to game data
    for (const circle of this.circles) {
      circle.data.x = circle.x;
      circle.data.y = circle.y;
      if (circle.data.type === "ball") {
        circle.data.velocity = { x: circle.vx, y: circle.vy };
      }
    }
    const paddleShape = paddle && this.paddleDriver.ref(paddle.key);
    if (paddleShape) {
      paddle.x = paddleShape.x;
      paddle.y = paddleShape.y;
    }
  };

  step(dt: number) {
    for (const shape of this.shapes) {
      if (shape.data.type !== "paddle") continue;
      // keep paddle inside the board
      const limit = BOARD_HALF_WIDTH - PADDLE_HALF_WIDTHS[shape.data.size];
      shape.x = Math.max(-limit, Math.min(limit, shape.x + shape.vx * dt));
    }

    for (const circle of this.circles) {
      circle.x += circle.vx * dt;
      circle.y += circle.vy * dt;

      for (const shape of this.shapes) {
        if (circle.data.type === "drop") {
          this.collideDrop(circle as Circle & { data: Drop }, shape);
        } else {
          this.collideBall(circle as Circle & { data: Ball }, shape);
        }
      }
    }
  }

  collideBall(circle: Circle & { data: Ball }, shape: Shape) {
    const hit = collide(circle, shape);
    if (!hit) return;

    // push out, and reflect if moving into the shape
    circle.x += hit.nx * hit.depth;
    circle.y += hit.ny * hit.depth;
    const vn = circle.vx * hit.nx + circle.vy * hit.ny;
    if (vn >= 0) return;
    circle.vx -= 2 * vn * hit.nx;
    circle.vy -= 2 * vn * hit.ny;

    const ball = circle.data;
    const other = shape.data;
    if (other.type === "brick") {
      this.emit("collide-ball-brick", { ball, brick: other });
    } else if (other.type === "paddle") {
      this.emit("collide-ball-paddle", { ball, paddle: other });
    } else if (other.type === "wall" && other.floor) {
      this.emit("collide-ball-bottom", { ball });
    }
  }

  collideDrop(circle: Circle & { data: Drop }, shape: Shape) {
    if (circle.reported) return;
    const other = shape.data;
    const isPaddle = other.type === "paddle";
    const isFloor = other.type === "wall" && other.floor;
    if (!isPaddle && !isFloor) return;
    if (!collide(circle, shape)) return;

    circle.reported = true;
    const drop = circle.data;
    if (isPaddle) {
      this.emit("collide-drop-paddle", { drop, paddle: other });
    } else {
      this.emit("collide-drop-bottom", { drop });
    }
  }

  addCircle(circle: Circle) {
    this.circles.push(circle);
    return circle;
  }

  addShape(shape: Shape) {
    this.shapes.push(shape);
    return shape;
  }

  remove<T>(array: T[], item: T) {
    const index = array.indexOf(item);
    if (index !== -1) array.splice(index, 1);
  }

  ballDriver = Driver.create<Ball, Circle>({
    filter: (data) => data.type === "ball",
    enter: (data) =>
      this.addCircle({
        data,
        x: data.x,
        y: data.y,
        vx: data.velocity.x,
        vy: data.velocity.y,
        radius: BALL_RADIUS,
      }),
    update: (data, circle) => {},
    exit: (data, circle) => this.remove(this.circles, circle),
  });

  dropDriver = Driver.create<Drop, Circle>({
    filter: (data) => data.type === "drop",
    enter: (data) =>
      this.addCircle({
        data,
        x: data.x,
        y: data.y,
        vx: 0,
        vy: data.speed,
        radius: DROP_RADIUS,
      }),
    update: (data, circle) => {},
    exit: (data, circle) => this.remove(this.circles, circle),
  });

  brickDriver = Driver.create<Brick, Shape>({
    filter: (data) => data.type === "brick",
    enter: (data) => {
      const half = BRICK_SIZES[data.size] / 2;
      return this.addShape(
        makeShape(data, data.x, data.y, [
          { x: -half, y: -half },
          { x: half, y: -half },
          { x: half, y: half },
          { x: -half, y: half },
        ]),
      );
    },
    update: (data, shape) => {
      // rows move down as new rows are added
      shape.x = data.x;
      shape.y = data.y;
    },
    exit: (data, shape) => this.remove(this.shapes, shape),
  });

  paddleDriver = Driver.create<Paddle, Shape>({
    filter: (data) => data.type === "paddle",
    enter: (data) => this.addShape(makeShape(data, data.x, data.y, PADDLE_PATHS[data.size])),
    update: (data, shape) => {
      shape.vx = data.speed;
    },
    exit: (data, shape) => this.remove(this.shapes, shape),
  });

  wallDriver = Driver.create<Wall, Shape>({
    filter: (data) => data.type === "wall",
    enter: (data) => this.addShape(makeShape(data, 0, 0, data.path)),
    update: (data, shape) => {},
    exit: (data, shape) => this.remove(this.shapes, shape),
  });

  binder = Binder.create<Entity>({
    key: (data) => data.key,
    drivers: [this.ballDriver, this.dropDriver, this.brickDriver, this.paddleDriver, this.wallDriver],
  });
}

/** Makes a shape from a path, closed if the path has 3 or more points. */
function makeShape(data: Shape["data"], x: number, y: number, path: Point[]): Shape {
  const segments: Segment[] = [];
  const closed = path.length >= 3;
  const count = closed ? path.length : path.length - 1;
  for (let i = 0; i < count; i++) {
    segments.push([path[i], path[(i + 1) % path.length]]);
  }
  const bound = Math.max(...path.map((p) => Math.hypot(p.x, p.y)));
  return { data, x, y, vx: 0, segments, bound };
}

/** Circle vs shape outline, returns contact normal and penetration depth, or null. */
function collide(circle: Circle, shape: Shape): Hit | null {
  // circle center in shape local coordinates
  const cx = circle.x - shape.x;
  const cy = circle.y - shape.y;

  const reach = shape.bound + circle.radius;
  if (cx * cx + cy * cy > reach * reach) return null;

  // closest point on the outline
  let minDistSq = Infinity;
  let qx = 0;
  let qy = 0;
  for (const [a, b] of shape.segments) {
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((cx - a.x) * ex + (cy - a.y) * ey) / (ex * ex + ey * ey)));
    const px = a.x + ex * t;
    const py = a.y + ey * t;
    const distSq = (cx - px) * (cx - px) + (cy - py) * (cy - py);
    if (distSq < minDistSq) {
      minDistSq = distSq;
      qx = px;
      qy = py;
    }
  }

  const inside = shape.segments.length >= 3 && isInside(cx, cy, shape.segments);
  if (!inside && minDistSq >= circle.radius * circle.radius) return null;

  const dist = Math.sqrt(minDistSq);
  let nx = dist > 0 ? (cx - qx) / dist : 0;
  let ny = dist > 0 ? (cy - qy) / dist : 1;
  if (inside) {
    // center went through the outline, e.g. a brick row moved onto the ball, push it out the nearest side
    nx = -nx;
    ny = -ny;
    return { nx, ny, depth: circle.radius + dist };
  }
  return { nx, ny, depth: circle.radius - dist };
}

/** Point inside a convex closed outline, in either winding order. */
function isInside(x: number, y: number, segments: Segment[]) {
  let sign = 0;
  for (const [a, b] of segments) {
    const cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
    if (cross === 0) continue;
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}
