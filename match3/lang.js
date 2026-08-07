export const GAME_LANG = {
  zh: {
    name: "三消", description: "交换彩色方块完成三消，打开盲盒制造连锁。",
    rules: "交换相邻方块，三个或更多同色方块相连即可消除。开局可能直接消除；棋盘无解时立即结束。",
    instructionsTitle: "三消",
    operationSelect: "连续点击两个相邻方块交换；也可以快速向四个方向滑动。",
    operationMystery: "带？的方块被消除时触发3×3、整行、整列或同色清除，效果可以继续触发盲盒。",
    operationScore: "每层得分＝消除格数 × 连锁层数 × 能量系数；每格充能1，能量每0.1秒衰减1。",
    board: "三消棋盘", tile: "方块", energy: "能量",
    resultReasons: { TIME_UP: "时间结束", NO_MOVES: "棋盘已无解" },
  },
  en: {
    name: "Match3", description: "Match colored tiles and open mystery tiles to build chains.",
    rules: "Swap adjacent tiles to connect three or more of one color. Opening matches clear after Start; no legal move ends the game immediately.",
    instructionsTitle: "Match3",
    operationSelect: "Tap two adjacent tiles to swap, or swipe quickly in one of four directions.",
    operationMystery: "A cleared ? tile triggers a 3×3, row, column, or same-color clear. Effects can trigger more mystery tiles.",
    operationScore: "Each layer scores cleared cells × chain × energy factor. Cells add 1 energy; energy loses 1 every 0.1 seconds.",
    board: "Match3 board", tile: "Tile", energy: "Energy",
    resultReasons: { TIME_UP: "Time up", NO_MOVES: "No legal moves" },
  },
};
