# Breakout Game - Polymatic Example

Implemented using [Polymatic](https://github.com/piqnt/polymatic) framework and [Pixi.js](https://pixijs.com/) rendering engine, with a minimal built-in physics (moving circles bouncing off line-segment outlines, see `src/Physics.ts`).

[Play Live Demo](https://piqnt.github.io/polymatic-example-breakout/)

Use left and right arrow keys to move the paddle, and space to start a new game. Catch `+` drops for an extra ball, and avoid `-` drops which shrink the paddle.

### How to run the code

To run or build the source code in this repository you need to have node.js/npm installed.

Install this project dependencies:

```sh
npm install
```

To run the project locally:

```sh
npm run dev
```

This will print out the url where you can open the project.

To build the project for production:

```sh
npm run build
```
