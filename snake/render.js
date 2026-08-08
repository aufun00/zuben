import { cfg } from "./config.js";
import { REWARD_ANT, REWARD_COIN, REWARD_FORAGE, REWARD_MYSTERY, REWARD_PREDATION } from "./engine.js";
import { PHASE_RUNNING } from "./runtime.js";
import { createSnakeSound } from "./sound.js";

const ATLAS_COLUMNS = 4;
const ATLAS_ROWS = 3;
const FRAME_BY_REWARD = Object.freeze({
  [REWARD_ANT]: 0,
  [REWARD_MYSTERY]: 9,
  [REWARD_COIN]: 10,
});
const WALK_SEQUENCE = Object.freeze([0, 1, 0, 2]);

export function createSnakeRenderer({ gameZone, runtime, performanceMeter, readBN = () => performance.now() }) {
  const board = gameZone.querySelector("[data-snake-board]");
  const cellsLayer = gameZone.querySelector("[data-snake-cells]");
  const feedbackLayer = gameZone.querySelector("[data-snake-feedback]");
  const cells = createCells(cellsLayer, cfg.BoardSize ** 2);
  const feedbackNodes = createFeedbackNodes(feedbackLayer, 6);
  const gamePage = gameZone.closest(".game-page");
  const sound = createSnakeSound({ surface: gamePage?.querySelector(".game-button") ?? gamePage ?? gameZone });
  let timer = null;
  let visible = !document.hidden;
  let destroyed = false;
  let atlasURL = null;
  let lastFeedbackIDs = "";
  let renderedBoardKey = "";

  board.style.setProperty("--snake-size", String(cfg.BoardSize));
  void createAtlas(board).then((url) => {
    if (destroyed) { URL.revokeObjectURL(url); return; }
    atlasURL = url;
    board.style.setProperty("--snake-atlas", `url("${url}")`);
    board.dataset.rasterReady = "true";
  }).catch(() => { board.dataset.rasterReady = "failed"; });

  function render() {
    timer = null;
    if (destroyed || !visible) return;
    const nowBN = readBN();
    if (runtime.shouldYieldRender(nowBN)) { runtime.wakePump(); schedule(0); return; }
    const snapshot = runtime.snapshot();
    if (snapshot) {
      sound.sync(snapshot);
      renderBoard(snapshot);
      renderFeedback(snapshot);
      performanceMeter.recordFrame(readBN());
    }
    schedule();
  }

  function renderBoard(snapshot) {
    const walkTick = snapshot.phase === PHASE_RUNNING ? Math.floor(snapshot.runGT / 125) : 0;
    const rewardKey = snapshot.rewards.map((reward) => `${reward.id}:${reward.index}:${reward.type}:${reward.variant}:${reward.expiresGT - snapshot.runGT <= cfg.RewardBlinkMS ? Math.floor(Math.max(0, reward.expiresGT - snapshot.runGT) / 500) : -1}`).join(";");
    const boardKey = `${snapshot.phase}|${walkTick}|${snapshot.direction}|${snapshot.snake.join(",")}|${rewardKey}`;
    if (boardKey === renderedBoardKey) return;
    renderedBoardKey = boardKey;
    for (const cell of cells) {
      cell.className = "snake-cell";
      cell.firstElementChild.hidden = true;
      cell.removeAttribute("data-kind");
      cell.style.removeProperty("--sprite-rotate");
    }
    snapshot.rewards.forEach((reward) => {
      const cell = cells[reward.index];
      cell.classList.add("is-reward");
      cell.dataset.kind = reward.type;
      const sprite = cell.firstElementChild;
      sprite.hidden = false;
      setFrame(sprite, rewardFrame(reward));
      const remaining = reward.expiresGT - snapshot.runGT;
      cell.classList.toggle("is-blinking", remaining <= cfg.RewardBlinkMS && Math.floor(Math.max(0, remaining) / 500) % 2 === 0);
    });
    const moving = snapshot.phase === PHASE_RUNNING;
    snapshot.snake.forEach((cellIndex, segmentIndex) => {
      const cell = cells[cellIndex];
      cell.className = "snake-cell is-snake";
      if (segmentIndex === 0) cell.classList.add("is-head");
      const sprite = cell.firstElementChild;
      sprite.hidden = false;
      const phase = moving ? (walkTick + segmentIndex) % WALK_SEQUENCE.length : 0;
      setFrame(sprite, WALK_SEQUENCE[phase]);
      cell.style.setProperty("--sprite-rotate", `${segmentRotation(snapshot.snake, segmentIndex, snapshot.direction, cfg.BoardSize)}deg`);
    });
  }

  function renderFeedback(snapshot) {
    const active = snapshot.feedbacks.filter((item) => snapshot.runGT >= item.atGT && snapshot.runGT - item.atGT < 700);
    const ids = active.map((item) => item.id).join(":");
    if (ids === lastFeedbackIDs && snapshot.phase !== PHASE_RUNNING) return;
    lastFeedbackIDs = ids;
    feedbackNodes.forEach((node, index) => {
      const item = active[index];
      if (!item || !item.text) { node.hidden = true; return; }
      const elapsed = snapshot.runGT - item.atGT;
      const row = Math.floor(item.index / cfg.BoardSize), col = item.index % cfg.BoardSize;
      node.hidden = false;
      node.textContent = item.text;
      node.dataset.kind = item.resolvedType;
      node.style.left = `${(col + 0.5) * 100 / cfg.BoardSize}%`;
      node.style.top = `${(row + 0.5) * 100 / cfg.BoardSize}%`;
      node.style.opacity = String(Math.max(0, 1 - elapsed / 700));
      node.style.transform = `translate(-50%, calc(-50% - ${elapsed * 0.035}px)) scale(${1 + Math.min(0.18, elapsed / 900)})`;
    });
  }

  function schedule(delay = cfg.RenderWaitMS) {
    if (!destroyed && visible && timer === null) timer = setTimeout(render, delay);
  }

  schedule(0);
  return Object.freeze({
    setVisible(value) {
      visible = Boolean(value);
      sound.setVisible(visible);
      if (!visible && timer !== null) { clearTimeout(timer); timer = null; }
      else if (visible) schedule(0);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      sound.destroy();
      if (atlasURL !== null) URL.revokeObjectURL(atlasURL);
      atlasURL = null;
    },
  });
}

function createCells(layer, count) {
  layer.replaceChildren();
  return Array.from({ length: count }, (_, index) => {
    const cell = document.createElement("div");
    cell.className = "snake-cell";
    cell.dataset.index = String(index);
    const sprite = document.createElement("span");
    sprite.className = "snake-sprite";
    sprite.hidden = true;
    sprite.setAttribute("aria-hidden", "true");
    cell.append(sprite);
    layer.append(cell);
    return cell;
  });
}

function createFeedbackNodes(layer, count) {
  layer.replaceChildren();
  return Array.from({ length: count }, () => {
    const node = document.createElement("span");
    node.className = "snake-float";
    node.hidden = true;
    node.setAttribute("aria-hidden", "true");
    layer.append(node);
    return node;
  });
}

function rewardFrame(reward) {
  if (reward.type === REWARD_FORAGE) return 3 + reward.variant;
  if (reward.type === REWARD_PREDATION) return 6 + reward.variant;
  return FRAME_BY_REWARD[reward.type];
}

function setFrame(node, frame) {
  const col = frame % ATLAS_COLUMNS, row = Math.floor(frame / ATLAS_COLUMNS);
  node.style.backgroundPosition = `${col * 100 / (ATLAS_COLUMNS - 1)}% ${row * 100 / (ATLAS_ROWS - 1)}%`;
}

function segmentRotation(snake, index, direction, size) {
  if (index === 0) return directionAngle(direction);
  const ahead = snake[index - 1], current = snake[index];
  const delta = ahead - current;
  if (delta === 1) return 90;
  if (delta === -1) return -90;
  if (delta === size) return 180;
  return 0;
}

function directionAngle(direction) {
  return ({ north: 0, east: 90, south: 180, west: -90 })[direction] ?? 0;
}

async function createAtlas(board) {
  const width = Math.max(16, board.getBoundingClientRect().width / cfg.BoardSize);
  const size = Math.min(128, nextPowerOfTwo(Math.ceil(width * Math.min(devicePixelRatio || 1, 3))));
  const canvas = document.createElement("canvas");
  canvas.width = size * ATLAS_COLUMNS;
  canvas.height = size * ATLAS_ROWS;
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) throw new Error("Snake raster canvas is unavailable");
  const drawers = [
    (ctx, s) => drawAnt(ctx, s, 0),
    (ctx, s) => drawAnt(ctx, s, -1),
    (ctx, s) => drawAnt(ctx, s, 1),
    drawLeaf, drawMushroom, drawFlower,
    drawLadybug, drawBeetle, drawCaterpillar,
    drawMystery, drawCoin,
  ];
  drawers.forEach((draw, frame) => {
    const col = frame % ATLAS_COLUMNS, row = Math.floor(frame / ATLAS_COLUMNS);
    context.save(); context.translate(col * size, row * size); draw(context, size); context.restore();
  });
  const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Snake raster encoding failed")), "image/png"));
  board.dataset.rasterSize = String(size);
  return URL.createObjectURL(blob);
}

function drawAnt(ctx, s, gait) {
  const u = s / 100;
  ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#281710"; ctx.lineWidth = 5.5 * u;
  const legs = gait < 0 ? [[45,45,22,28],[48,52,20,53],[49,59,27,76],[55,45,78,25],[56,52,81,50],[55,59,77,78]]
    : gait > 0 ? [[45,45,24,24],[48,52,18,49],[49,59,24,80],[55,45,76,30],[56,52,82,55],[55,59,74,74]]
      : [[45,45,24,31],[48,52,19,52],[49,59,26,73],[55,45,76,31],[56,52,81,52],[55,59,74,73]];
  ctx.beginPath(); for (const [x1,y1,x2,y2] of legs) { ctx.moveTo(x1*u,y1*u); ctx.lineTo(x2*u,y2*u); } ctx.stroke();
  const gradient = ctx.createRadialGradient(43*u,34*u,2*u,52*u,52*u,34*u); gradient.addColorStop(0,"#7a4932"); gradient.addColorStop(.45,"#48271d"); gradient.addColorStop(1,"#160d0a"); ctx.fillStyle = gradient;
  for (const [x,y,rx,ry] of [[50,25,13,12],[50,49,11,13],[50,73,17,15]]) { ctx.beginPath(); ctx.ellipse(x*u,y*u,rx*u,ry*u,0,0,Math.PI*2); ctx.fill(); }
  ctx.strokeStyle="#2b1710"; ctx.lineWidth=3*u; ctx.beginPath(); ctx.moveTo(44*u,16*u);ctx.quadraticCurveTo(31*u,7*u,27*u,14*u);ctx.moveTo(56*u,16*u);ctx.quadraticCurveTo(69*u,7*u,73*u,14*u);ctx.stroke();
  ctx.fillStyle="#ffd96a"; ctx.beginPath();ctx.arc(45*u,22*u,2.2*u,0,Math.PI*2);ctx.arc(55*u,22*u,2.2*u,0,Math.PI*2);ctx.fill();
}

function drawLeaf(ctx,s){const u=s/100;ctx.fillStyle="#54c878";ctx.strokeStyle="#176b42";ctx.lineWidth=4*u;ctx.beginPath();ctx.moveTo(20*u,70*u);ctx.quadraticCurveTo(26*u,18*u,79*u,22*u);ctx.quadraticCurveTo(72*u,73*u,20*u,70*u);ctx.fill();ctx.stroke();ctx.beginPath();ctx.moveTo(24*u,69*u);ctx.lineTo(70*u,30*u);ctx.stroke();}
function drawMushroom(ctx,s){const u=s/100;ctx.fillStyle="#f3e3c1";roundRect(ctx,42*u,46*u,18*u,36*u,7*u);ctx.fill();ctx.fillStyle="#e95f68";ctx.beginPath();ctx.arc(51*u,43*u,28*u,Math.PI,0);ctx.lineTo(79*u,46*u);ctx.lineTo(23*u,46*u);ctx.closePath();ctx.fill();ctx.fillStyle="#fff3";ctx.beginPath();ctx.arc(42*u,29*u,7*u,0,Math.PI*2);ctx.arc(62*u,38*u,5*u,0,Math.PI*2);ctx.fill();}
function drawFlower(ctx,s){const u=s/100;ctx.strokeStyle="#3d9157";ctx.lineWidth=5*u;ctx.beginPath();ctx.moveTo(50*u,50*u);ctx.lineTo(50*u,84*u);ctx.stroke();ctx.fillStyle="#ff80b3";for(let a=0;a<6;a++){const t=a*Math.PI/3;ctx.beginPath();ctx.ellipse((50+20*Math.cos(t))*u,(40+20*Math.sin(t))*u,11*u,17*u,t,0,Math.PI*2);ctx.fill();}ctx.fillStyle="#ffd65c";ctx.beginPath();ctx.arc(50*u,40*u,11*u,0,Math.PI*2);ctx.fill();}
function drawLadybug(ctx,s){const u=s/100;ctx.fillStyle="#232323";ctx.beginPath();ctx.arc(50*u,28*u,12*u,0,Math.PI*2);ctx.fill();ctx.fillStyle="#ed4c52";ctx.beginPath();ctx.ellipse(50*u,57*u,26*u,31*u,0,0,Math.PI*2);ctx.fill();ctx.strokeStyle="#252525";ctx.lineWidth=4*u;ctx.beginPath();ctx.moveTo(50*u,29*u);ctx.lineTo(50*u,86*u);ctx.stroke();ctx.fillStyle="#242424";for(const [x,y] of [[37,48],[64,48],[36,67],[64,69]]){ctx.beginPath();ctx.arc(x*u,y*u,5*u,0,Math.PI*2);ctx.fill();}}
function drawBeetle(ctx,s){const u=s/100;const g=ctx.createLinearGradient(25*u,20*u,75*u,85*u);g.addColorStop(0,"#61e4d0");g.addColorStop(.5,"#3b70c8");g.addColorStop(1,"#65369b");ctx.fillStyle=g;ctx.strokeStyle="#17253c";ctx.lineWidth=5*u;ctx.beginPath();ctx.ellipse(50*u,56*u,27*u,34*u,0,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.beginPath();ctx.moveTo(50*u,22*u);ctx.lineTo(50*u,88*u);ctx.stroke();}
function drawCaterpillar(ctx,s){const u=s/100;ctx.fillStyle="#76d45b";for(let i=0;i<4;i++){ctx.beginPath();ctx.arc((27+i*16)*u,(62-i*7)*u,(15-i)*u,0,Math.PI*2);ctx.fill();}ctx.fillStyle="#f5f3a4";ctx.beginPath();ctx.arc(75*u,37*u,4*u,0,Math.PI*2);ctx.fill();}
function drawMystery(ctx,s){const u=s/100;const g=ctx.createLinearGradient(20*u,18*u,80*u,82*u);g.addColorStop(0,"#b79cff");g.addColorStop(1,"#653bc8");ctx.fillStyle=g;ctx.strokeStyle="#e8ddff";ctx.lineWidth=4*u;roundRect(ctx,20*u,20*u,60*u,60*u,12*u);ctx.fill();ctx.stroke();ctx.fillStyle="#fff";ctx.font=`bold ${48*u}px system-ui`;ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText("?",50*u,52*u);}
function drawCoin(ctx,s){const u=s/100;const g=ctx.createRadialGradient(39*u,34*u,4*u,50*u,52*u,34*u);g.addColorStop(0,"#fff4a8");g.addColorStop(.45,"#ffd43d");g.addColorStop(1,"#c98100");ctx.fillStyle=g;ctx.strokeStyle="#fff0a1";ctx.lineWidth=5*u;ctx.beginPath();ctx.arc(50*u,50*u,31*u,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle="#704500";ctx.beginPath();ctx.moveTo(56*u,19*u);ctx.lineTo(35*u,51*u);ctx.lineTo(49*u,50*u);ctx.lineTo(41*u,80*u);ctx.lineTo(67*u,42*u);ctx.lineTo(52*u,44*u);ctx.closePath();ctx.fill();}
function roundRect(ctx,x,y,w,h,r){ctx.beginPath();ctx.roundRect(x,y,w,h,r);}
function nextPowerOfTwo(value){let result=1;while(result<value)result*=2;return result;}
