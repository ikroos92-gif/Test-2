const canvas = document.getElementById('tub');
const ctx = canvas.getContext('2d');

const dropButton = document.getElementById('drop-match');
const refreshButton = document.getElementById('refresh-matches');
const currencyEl = document.getElementById('currency');
const unburntEl = document.getElementById('unburnt');
const burningEl = document.getElementById('burning');
const refreshCostEl = document.getElementById('refresh-cost');
const capacityEl = document.getElementById('capacity');

const state = {
  currency: 0,
  unburntCount: 0,
  burningCount: 0,
  baseMatchesPerDrop: 1,
  baseSparksPerMatch: 3,
  baseIgnitionChance: 0.45,
  baseSpecialChance: 0.08,
  specialSparkBonus: 2,
  burnTicks: 2,
  loadFillRatio: 0.4,
  upgrades: {
    matchesPerDrop: 0,
    sparksPerMatch: 0,
    specialMatchChance: 0,
    tubSize: 0,
    sparkReach: 0,
  },
};

const tub = {
  baseCols: 14,
  baseRows: 10,
  cols: 14,
  rows: 10,
  paddingX: 36,
  paddingY: 36,
  hexSize: 18,
  hexWidth: 0,
  hexHeight: 0,
  verticalSpacing: 0,
  pixelWidth: canvas.width,
  pixelHeight: canvas.height,
  centers: [],
};

let grid = createGrid(tub.cols, tub.rows);
let sparks = [];
let lastFrame = performance.now();

const upgradeConfig = {
  matchesPerDrop: {
    baseCost: 25,
    costGrowth: 1.75,
    maxLevel: 12,
    apply() {
      state.upgrades.matchesPerDrop += 1;
    },
  },
  sparksPerMatch: {
    baseCost: 40,
    costGrowth: 1.7,
    maxLevel: 12,
    apply() {
      state.upgrades.sparksPerMatch += 1;
    },
  },
  specialMatchChance: {
    baseCost: 55,
    costGrowth: 1.8,
    maxLevel: 10,
    apply() {
      state.upgrades.specialMatchChance += 1;
    },
  },
  tubSize: {
    baseCost: 120,
    costGrowth: 2,
    maxLevel: 6,
    apply() {
      state.upgrades.tubSize += 1;
      resizeTub();
    },
  },
  sparkReach: {
    baseCost: 85,
    costGrowth: 1.9,
    maxLevel: 6,
    apply() {
      state.upgrades.sparkReach += 1;
    },
  },
};

function createGrid(cols, rows) {
  const cells = [];
  for (let row = 0; row < rows; row += 1) {
    const line = [];
    for (let col = 0; col < cols; col += 1) {
      line.push({
        row,
        col,
        state: 'empty',
        burnTimer: 0,
        special: false,
      });
    }
    cells.push(line);
  }
  return cells;
}

function handleResize() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  tub.pixelWidth = rect.width;
  tub.pixelHeight = rect.height;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  updateTubGeometry();
}

function updateTubGeometry() {
  const { pixelWidth: width, pixelHeight: height } = tub;
  const paddingX = Math.min(64, Math.max(32, width * 0.06));
  const paddingY = Math.min(64, Math.max(28, height * 0.08));
  const availableWidth = Math.max(width - paddingX * 2, 120);
  const availableHeight = Math.max(height - paddingY * 2, 120);
  const hexWidthCandidate = availableWidth / (tub.cols + 0.5);
  const hexHeightCandidate = availableHeight / (tub.rows * 0.75 + 0.25);
  const hexSize = Math.min(hexWidthCandidate / Math.sqrt(3), hexHeightCandidate / 2);

  tub.paddingX = paddingX;
  tub.paddingY = paddingY;
  tub.hexSize = hexSize;
  tub.hexWidth = Math.sqrt(3) * hexSize;
  tub.hexHeight = 2 * hexSize;
  tub.verticalSpacing = tub.hexHeight * 0.75;
  tub.centers = [];

  for (let row = 0; row < tub.rows; row += 1) {
    const line = [];
    for (let col = 0; col < tub.cols; col += 1) {
      const x =
        tub.paddingX +
        col * tub.hexWidth +
        (row % 2 ? tub.hexWidth / 2 : 0) +
        tub.hexWidth / 2;
      const y = tub.paddingY + row * tub.verticalSpacing + tub.hexHeight / 2;
      line.push({ x, y });
    }
    tub.centers.push(line);
  }
}

function offsetToAxial(col, row) {
  return {
    q: col - (row - (row & 1)) / 2,
    r: row,
  };
}

function axialToOffset(q, r) {
  const col = q + (r - (r & 1)) / 2;
  const row = r;
  if (row < 0 || row >= tub.rows || col < 0 || col >= tub.cols) {
    return null;
  }
  return { col, row };
}

function getCellsInRadius(col, row, radius) {
  const results = [];
  const origin = offsetToAxial(col, row);
  for (let dq = -radius; dq <= radius; dq += 1) {
    for (
      let dr = Math.max(-radius, -dq - radius);
      dr <= Math.min(radius, -dq + radius);
      dr += 1
    ) {
      const ds = -dq - dr;
      const distance = (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
      if (distance === 0) continue;
      const axial = { q: origin.q + dq, r: origin.r + dr };
      const offset = axialToOffset(axial.q, axial.r);
      if (!offset) continue;
      results.push({ cell: grid[offset.row][offset.col], distance });
    }
  }
  return results;
}

function changeCellState(cell, newState, options = {}) {
  const { awardCurrency = true } = options;
  const previous = cell.state;
  if (previous === newState) return;

  if (previous === 'idle') {
    state.unburntCount -= 1;
  } else if (previous === 'burning') {
    state.unburntCount -= 1;
    state.burningCount -= 1;
  }

  cell.state = newState;

  if (newState === 'idle') {
    state.unburntCount += 1;
  } else if (newState === 'burning') {
    state.unburntCount += 1;
    state.burningCount += 1;
  } else if (newState === 'empty') {
    cell.special = false;
    cell.burnTimer = 0;
  } else if (newState === 'burnt') {
    cell.special = false;
    cell.burnTimer = 0;
    if (awardCurrency && previous !== 'burnt') {
      state.currency += 1;
    }
  }
}

function recomputeCounts() {
  state.unburntCount = 0;
  state.burningCount = 0;
  for (let row = 0; row < tub.rows; row += 1) {
    for (let col = 0; col < tub.cols; col += 1) {
      const cell = grid[row][col];
      if (cell.state === 'idle') state.unburntCount += 1;
      if (cell.state === 'burning') {
        state.unburntCount += 1;
        state.burningCount += 1;
      }
    }
  }
}

function placeMatch(cell, { ignite = false, special = null } = {}) {
  if (special !== null) {
    cell.special = special;
  } else if (cell.state === 'empty' || cell.state === 'burnt') {
    cell.special = false;
  }

  if (ignite) {
    cell.burnTimer = state.burnTicks;
    changeCellState(cell, 'burning');
  } else {
    cell.burnTimer = 0;
    changeCellState(cell, 'idle');
  }
}

function igniteCell(cell) {
  if (cell.state === 'burning') return;
  cell.burnTimer = state.burnTicks;
  changeCellState(cell, 'burning');
}

function getMatchesPerDrop() {
  return state.baseMatchesPerDrop + state.upgrades.matchesPerDrop;
}

function getSparksPerMatch(wasSpecial = false) {
  let amount = state.baseSparksPerMatch + state.upgrades.sparksPerMatch;
  if (wasSpecial) {
    amount += state.specialSparkBonus + state.upgrades.specialMatchChance;
  }
  return amount;
}

function getSpecialChance() {
  return Math.min(
    0.75,
    state.baseSpecialChance + state.upgrades.specialMatchChance * 0.08
  );
}

function getSparkReach() {
  return 1 + state.upgrades.sparkReach;
}

function getIgnitionChance(wasSpecial, distance) {
  let chance =
    state.baseIgnitionChance +
    state.upgrades.sparksPerMatch * 0.04 +
    state.upgrades.sparkReach * 0.03;
  if (wasSpecial) chance += 0.18;
  if (distance > 1) {
    chance -= (distance - 1) * 0.08;
  }
  return Math.max(0.05, Math.min(0.98, chance));
}

function availableCells(predicate) {
  const pool = [];
  for (let row = 0; row < tub.rows; row += 1) {
    for (let col = 0; col < tub.cols; col += 1) {
      const cell = grid[row][col];
      if (!predicate || predicate(cell)) {
        pool.push(cell);
      }
    }
  }
  return pool;
}

function randomFrom(array) {
  if (!array.length) return null;
  const index = Math.floor(Math.random() * array.length);
  return array[index];
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function dropMatches(count) {
  let placed = 0;
  let attempts = 0;
  while (placed < count && attempts < count * 8) {
    attempts += 1;
    let cell = randomFrom(availableCells((candidate) => candidate.state === 'idle'));
    if (!cell) {
      cell = randomFrom(
        availableCells((candidate) => candidate.state === 'empty' || candidate.state === 'burnt')
      );
    }
    if (!cell) break;
    if (cell.state === 'burning') continue;

    if (cell.state === 'idle') {
      igniteCell(cell);
      placed += 1;
      continue;
    }

    if (cell.state === 'empty' || cell.state === 'burnt') {
      const isSpecial = Math.random() < getSpecialChance();
      placeMatch(cell, { ignite: true, special: isSpecial });
      placed += 1;
    }
  }
  updateUI();
}

function seedTub() {
  const empties = shuffle(
    availableCells((cell) => cell.state === 'empty' || cell.state === 'burnt')
  );
  const target = Math.floor(empties.length * state.loadFillRatio);
  for (let i = 0; i < target && i < empties.length; i += 1) {
    const cell = empties[i];
    if (!cell) continue;
    const isSpecial = Math.random() < getSpecialChance() * 0.6;
    placeMatch(cell, { ignite: false, special: isSpecial });
  }
  updateUI();
}

function refreshMatches() {
  const cost = state.unburntCount;
  if (state.currency < cost) return;
  state.currency -= cost;
  for (let row = 0; row < tub.rows; row += 1) {
    for (let col = 0; col < tub.cols; col += 1) {
      const cell = grid[row][col];
      changeCellState(cell, 'empty', { awardCurrency: false });
    }
  }
  state.unburntCount = 0;
  state.burningCount = 0;
  seedTub();
  updateUI();
}

function resizeTub() {
  const newCols = tub.baseCols + state.upgrades.tubSize * 2;
  const newRows = tub.baseRows + state.upgrades.tubSize * 2;
  const newGrid = createGrid(newCols, newRows);

  const colOffset = Math.floor((newCols - tub.cols) / 2);
  const rowOffset = Math.floor((newRows - tub.rows) / 2);

  for (let row = 0; row < tub.rows; row += 1) {
    for (let col = 0; col < tub.cols; col += 1) {
      const cell = grid[row][col];
      const targetCol = col + colOffset;
      const targetRow = row + rowOffset;
      if (
        targetRow >= 0 &&
        targetRow < newRows &&
        targetCol >= 0 &&
        targetCol < newCols
      ) {
        const targetCell = newGrid[targetRow][targetCol];
        targetCell.state = cell.state;
        targetCell.special = cell.special;
        targetCell.burnTimer = cell.burnTimer;
      }
    }
  }

  tub.cols = newCols;
  tub.rows = newRows;
  grid = newGrid;
  recomputeCounts();
  handleResize();
  updateUI();
}

function emitSparks(cell, wasSpecial) {
  const reach = getSparkReach();
  const neighbors = getCellsInRadius(cell.col, cell.row, reach);
  if (!neighbors.length) return;

  const sparkCount = Math.max(1, getSparksPerMatch(wasSpecial));
  const startCenter = tub.centers[cell.row][cell.col];

  for (let i = 0; i < sparkCount; i += 1) {
    const pick = neighbors[Math.floor(Math.random() * neighbors.length)];
    if (!pick) continue;
    const { cell: target, distance } = pick;
    const endCenter = tub.centers[target.row][target.col];
    const jitterX = (Math.random() - 0.5) * tub.hexWidth * 0.2;
    const jitterY = (Math.random() - 0.5) * tub.hexHeight * 0.2;
    const hue = wasSpecial ? 25 : 35 + Math.random() * 10;
    sparks.push({
      start: { x: startCenter.x, y: startCenter.y },
      end: { x: endCenter.x + jitterX, y: endCenter.y + jitterY },
      progress: 0,
      duration: 220 + Math.random() * 180,
      hue,
      intensity: Math.max(0.35, 1 - (distance - 1) * 0.25),
    });

    if (target.state === 'idle') {
      const chance = getIgnitionChance(wasSpecial, distance);
      if (Math.random() < chance) {
        igniteCell(target);
      }
    }
  }
}

function updateSparks(delta) {
  sparks.forEach((spark) => {
    spark.progress += delta / spark.duration;
  });
  sparks = sparks.filter((spark) => spark.progress < 1);
}

function drawHex(centerX, centerY, size) {
  ctx.beginPath();
  for (let i = 0; i < 6; i += 1) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    const x = centerX + size * Math.cos(angle);
    const y = centerY + size * Math.sin(angle);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function computeHighlightMap() {
  const highlights = new Map();
  for (let row = 0; row < tub.rows; row += 1) {
    for (let col = 0; col < tub.cols; col += 1) {
      const cell = grid[row][col];
      if (cell.state !== 'burning') continue;
      const radius = getSparkReach();
      const neighbors = getCellsInRadius(col, row, radius);
      neighbors.forEach(({ cell: target, distance }) => {
        const key = `${target.row}:${target.col}`;
        const intensity = Math.max(0.15, 1 - (distance - 1) / Math.max(1, radius));
        highlights.set(key, Math.max(highlights.get(key) || 0, intensity));
      });
    }
  }
  return highlights;
}

function draw() {
  ctx.clearRect(0, 0, tub.pixelWidth, tub.pixelHeight);
  const highlights = computeHighlightMap();

  for (let row = 0; row < tub.rows; row += 1) {
    for (let col = 0; col < tub.cols; col += 1) {
      const cell = grid[row][col];
      const center = tub.centers[row][col];
      const key = `${row}:${col}`;
      const highlight = highlights.get(key) || 0;

      drawHex(center.x, center.y, tub.hexSize * 0.96);
      let fill = 'rgba(255, 255, 255, 0.03)';
      let stroke = 'rgba(255, 255, 255, 0.05)';

      if (cell.state === 'idle') {
        fill = `rgba(230, 190, 130, ${0.18 + highlight * 0.2})`;
        stroke = 'rgba(255, 200, 150, 0.25)';
      } else if (cell.state === 'burning') {
        fill = 'rgba(255, 132, 54, 0.7)';
        stroke = 'rgba(255, 180, 90, 0.9)';
        ctx.shadowBlur = 18;
        ctx.shadowColor = 'rgba(255, 140, 60, 0.7)';
      } else if (cell.state === 'burnt') {
        fill = 'rgba(60, 62, 70, 0.35)';
        stroke = 'rgba(120, 120, 130, 0.3)';
      }

      if (highlight && cell.state !== 'burning') {
        fill = `rgba(255, 180, 80, ${0.15 + highlight * 0.25})`;
      }

      ctx.fillStyle = fill;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.2;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.stroke();

      if (cell.special && (cell.state === 'idle' || cell.state === 'burning')) {
        ctx.save();
        ctx.translate(center.x, center.y);
        ctx.rotate(Math.PI / 6);
        ctx.fillStyle = 'rgba(255, 230, 140, 0.75)';
        ctx.beginPath();
        ctx.moveTo(0, -tub.hexSize * 0.3);
        ctx.lineTo(tub.hexSize * 0.18, tub.hexSize * 0.1);
        ctx.lineTo(0, tub.hexSize * 0.35);
        ctx.lineTo(-tub.hexSize * 0.18, tub.hexSize * 0.1);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }
  }

  drawSparks();
}

function drawSparks() {
  sparks.forEach((spark) => {
    const progress = Math.min(1, spark.progress);
    const eased = progress < 0.5 ? 2 * progress * progress : -1 + (4 - 2 * progress) * progress;
    const x = spark.start.x + (spark.end.x - spark.start.x) * eased;
    const y = spark.start.y + (spark.end.y - spark.start.y) * eased;

    ctx.strokeStyle = `hsla(${spark.hue}, 100%, 65%, ${0.25 + (1 - progress) * 0.55})`;
    ctx.lineWidth = 1.5 + spark.intensity * 1.2;
    ctx.beginPath();
    ctx.moveTo(spark.start.x, spark.start.y);
    ctx.lineTo(x, y);
    ctx.stroke();

    ctx.fillStyle = `hsla(${spark.hue}, 100%, 70%, ${0.3 + (1 - progress) * 0.5})`;
    ctx.beginPath();
    ctx.arc(x, y, 2.2 + spark.intensity * 1.5, 0, Math.PI * 2);
    ctx.fill();
  });
}

function updateUI() {
  currencyEl.textContent = formatNumber(state.currency);
  unburntEl.textContent = state.unburntCount;
  burningEl.textContent = state.burningCount;
  refreshCostEl.textContent = state.unburntCount;
  capacityEl.textContent = tub.cols * tub.rows;

  const dropCount = getMatchesPerDrop();
  dropButton.textContent = `Drop ${dropCount} Match${dropCount > 1 ? 'es' : ''}`;
  refreshButton.disabled = state.currency < state.unburntCount;

  updateUpgradeButtons();
}

function updateUpgradeButtons() {
  document.querySelectorAll('.upgrade[data-upgrade]').forEach((node) => {
    const key = node.dataset.upgrade;
    const config = upgradeConfig[key];
    const button = node.querySelector('button.buy');
    if (!config || !button) return;
    const level = state.upgrades[key];
    const cost = Math.floor(config.baseCost * Math.pow(config.costGrowth, level));
    const maxed = config.maxLevel !== undefined && level >= config.maxLevel;
    button.disabled = maxed || state.currency < cost;
    button.textContent = maxed ? 'Maxed' : `Buy (${formatNumber(cost)})`;
    const tooltip =
      key === 'matchesPerDrop'
        ? `Current: ${getMatchesPerDrop()} matches / drop`
        : key === 'sparksPerMatch'
        ? `Current: ${state.baseSparksPerMatch + state.upgrades.sparksPerMatch} sparks`
        : key === 'specialMatchChance'
        ? `Special chance: ${(getSpecialChance() * 100).toFixed(1)}%`
        : key === 'tubSize'
        ? `Tub size: ${tub.cols}×${tub.rows}`
        : key === 'sparkReach'
        ? `Reach radius: ${getSparkReach()} hexes`
        : '';
    if (tooltip) button.title = tooltip;
  });
}

function formatNumber(value) {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: value < 10 ? 1 : 0,
  }).format(value);
}

function tick() {
  const toResolve = [];
  for (let row = 0; row < tub.rows; row += 1) {
    for (let col = 0; col < tub.cols; col += 1) {
      const cell = grid[row][col];
      if (cell.state === 'burning') {
        cell.burnTimer -= 1;
        if (cell.burnTimer <= 0) {
          toResolve.push({ cell, wasSpecial: cell.special });
        }
      }
    }
  }

  toResolve.forEach(({ cell, wasSpecial }) => {
    changeCellState(cell, 'burnt');
    emitSparks(cell, wasSpecial);
  });

  updateUI();
}

function loop(time) {
  const delta = time - lastFrame;
  lastFrame = time;
  updateSparks(delta);
  draw();
  requestAnimationFrame(loop);
}

function attachUpgradeHandlers() {
  document.querySelectorAll('.upgrade[data-upgrade] button.buy').forEach((button) => {
    button.addEventListener('click', () => {
      const wrapper = button.closest('.upgrade[data-upgrade]');
      if (!wrapper) return;
      const key = wrapper.dataset.upgrade;
      const config = upgradeConfig[key];
      if (!config) return;
      const level = state.upgrades[key];
      const cost = Math.floor(config.baseCost * Math.pow(config.costGrowth, level));
      if (config.maxLevel !== undefined && level >= config.maxLevel) return;
      if (state.currency < cost) return;
      state.currency -= cost;
      config.apply();
      if (key === 'tubSize') {
        seedTub();
      }
      updateUI();
    });
  });
}

dropButton.addEventListener('click', () => {
  dropMatches(getMatchesPerDrop());
});

refreshButton.addEventListener('click', () => {
  refreshMatches();
});

window.addEventListener('resize', handleResize);

attachUpgradeHandlers();
handleResize();
seedTub();
updateUI();
setInterval(tick, 420);
requestAnimationFrame(loop);
